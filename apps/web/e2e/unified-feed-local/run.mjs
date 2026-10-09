import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "../lounge-local/server.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const work = path.join(root, "work/unified-feed-20261009");
const visual = path.join(work, "visual");
const evidenceFile = path.join(work, "evidence.json");
const previewFile = path.join(work, "preview.json");
const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "id", "vi", "th", "pt", "fr"];
const compactLocales = ["ko", "ja", "vi", "th"];
const images = {
  official: path.join(root, "apps/web/public/images/guest-home/elina-card.jpg"),
  fan: path.join(root, "apps/web/public/images/guest-home/changha-card.jpg"),
  other: path.join(root, "apps/web/public/images/calendar/yuna-portrait.jpg"),
};

await mkdir(visual, { recursive: true });
assert.equal(process.env.PGPORT, "55479", "unified-feed runner requires the disposable database on port 55479");
const harness = await startHarness({ fanWebMode: true });
const evidence = { checks: [], matrix: [], screenshots: [], pageErrors: [], axe: [], measurements: {}, fixtures: {}, failure: null };
const pass = message => { evidence.checks.push(message); console.log(`PASS ${message}`); };
const auth = actor => actor ? { authorization: `Bearer lounge-local-${actor}` } : {};

async function api(actor, pathname, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(harness.baseURL + pathname, {
    method,
    headers: { ...auth(actor), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert(response.ok, `${method} ${pathname} failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

async function upload(actor, fixture) {
  const form = new FormData();
  form.append("celebritySlug", "elina");
  form.append("file", new Blob([await readFile(fixture)], { type: "image/jpeg" }), path.basename(fixture));
  const response = await fetch(`${harness.baseURL}/api/content-assets`, { method: "POST", headers: auth(actor), body: form });
  const data = await response.json();
  assert.equal(response.status, 201, `asset upload failed: ${JSON.stringify(data)}`);
  return data.asset;
}

const sqlJson = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
async function seed() {
  const [officialAsset, fanAsset, otherAsset] = await Promise.all([
    upload("admin", images.official), upload("fan", images.fan), upload("other", images.other),
  ]);
  const fanPost = await api("fan", "/api/celebrities/elina/posts", {
    body: "무대 뒤에서 발견한 따뜻한 순간을 팬들과 함께 나눠요. 오늘도 좋은 노래 고마워요.",
    visibility: "public", assetIds: [fanAsset.id], idempotencyKey: crypto.randomUUID(),
  });
  const otherPost = await api("other", "/api/celebrities/elina/posts", {
    body: "공연을 기다리며 찍은 하늘이에요. 서로의 이야기가 이어지는 팬게시판이 되었으면 좋겠어요.",
    visibility: "public", assetIds: [otherAsset.id], idempotencyKey: crypto.randomUUID(),
  });
  const noticeId = "c7300000-0000-4000-8000-000000000002";
  const cheerId = "c7500000-0000-4000-8000-000000000010";
  const koBody = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "새로운 촬영 현장의 분위기를 전해요. 팬 여러분과 곧 만나요." }] },
    { type: "image", attrs: { src: `/api/content-assets/${officialAsset.id}`, alt: "엘리나 공식 촬영 현장", width: officialAsset.width, height: officialAsset.height } },
  ] };
  const enBody = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "A glimpse from the latest shoot. See you soon." }] },
    { type: "image", attrs: { src: `/api/content-assets/${officialAsset.id}`, alt: "Elina at an official shoot", width: officialAsset.width, height: officialAsset.height } },
  ] };
  await harness.query(`begin;
    update public.user_profiles
      set nickname='별빛을따라걷는아주긴팬닉네임_2026',
          nickname_normalized='별빛을따라걷는아주긴팬닉네임_2026'
      where app_user_id='${harness.actors.other.id}';
    insert into public.celebrity_notices(id,celebrity_id,slug,publication_status,published_at,ever_published_at,post_type,visibility)
      values('${noticeId}','c7200000-0000-4000-8000-000000000001','studio-moment','published',now()-interval '1 minute',now()-interval '1 minute','artist_post','public');
    insert into public.celebrity_notice_localizations(notice_id,locale,title,body_json) values
      ('${noticeId}','ko','새 촬영 현장에서 전하는 소식',${sqlJson(koBody)}),
      ('${noticeId}','en','A note from the new shoot',${sqlJson(enBody)});
    update public.content_assets set notice_id='${noticeId}',position=0 where id='${officialAsset.id}';
    insert into public.fan_lounge_messages(id,celebrity_id,app_user_id,body,idempotency_key,created_at)
      values('${cheerId}','c7200000-0000-4000-8000-000000000001','${harness.actors.fan.id}','오늘도 노래와 함께 시작해요. 늘 응원합니다.','c7510000-0000-4000-8000-000000000010',now()-interval '2 minutes');
    commit;`, false);
  Object.assign(evidence.fixtures, { noticeId, cheerId, fanPostId: fanPost.id, otherPostId: otherPost.id, assetIds: [officialAsset.id, fanAsset.id, otherAsset.id] });
  return { noticeId, cheerId, fanPost, otherPost };
}

const boardUrl = (locale = "ko", source = "all") => `${harness.baseURL}/elina?tab=board${source === "all" ? "" : `&source=${source}`}&locale=${locale}#celebrity-content`;
const mediaUrl = (locale = "ko", filter) => `${harness.baseURL}/elina?tab=board&section=media&locale=${locale}${filter ? `&media=${filter}` : ""}#celebrity-content`;
const routePath = value => { const url = new URL(value, harness.baseURL); return `${url.pathname}${url.search}${url.hash}`; };
async function settle(page, selector = "#celebrity-content") {
  await page.waitForSelector(selector, { state: "attached", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function assertNoOverflow(page, label) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert(size.scroll <= size.client + 1, `${label} horizontal overflow (${size.scroll} > ${size.client})`);
}
async function goto(page, url, contentSelector) {
  const errorsAtStart = evidence.pageErrors.length;
  if (page.url() === url) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle(page, contentSelector);
  await assertNoOverflow(page, url);
  assert.equal(evidence.pageErrors.length, errorsAtStart, `${url} emitted an uncaught application error`);
}
async function waitForLoadedImages(page, selector, requireImages = false) {
  const images = page.locator(`${selector}:visible`);
  if (requireImages) await expect(images.first(), `${selector} must contain at least one image`).toBeVisible();
  const count = await images.count();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  for (let index = 0; index < count; index += 1) await images.nth(index).scrollIntoViewIfNeeded();
  await expect.poll(() => images.evaluateAll(nodes => nodes.every(image => image.complete && image.naturalWidth > 0)), { message: `${selector} images must finish loading` }).toBe(true);
  await page.evaluate(position => window.scrollTo(position.x, position.y), scroll);
}
async function snap(page, name, fullPage = true) {
  if (fullPage) {
    await waitForLoadedImages(page, "img");
    await page.mouse.click(1, 40);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  const file = path.join(visual, name);
  await page.screenshot({ path: file, fullPage, style: 'aside[aria-label="Local test account"] { display:none !important; }' });
  evidence.screenshots.push(file);
}
async function watch(page) {
  page.on("pageerror", error => {
    const record = { url: page.url(), message: error.message };
    evidence.pageErrors.push(record);
    console.error("BROWSER_ERROR", record.url, record.message);
  });
}
async function installStableMediaRoutes(context) {
  await context.route("**/api/celebrities/elina/instagram", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], updatedAt: null }) }));
  await context.route("**/api/live-events?*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ catalog: { replay: [] } }) }));
}

let browser, activePage, fixture;
try {
  fixture = await seed();
  pass("real handlers and PostgreSQL seeded one official artist post, two image fan posts and one legacy cheer");

  browser = await chromium.launch({ headless: true });
  const fanContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await fanContext.addInitScript(() => localStorage.setItem("lounge-test-identity", "fan"));
  await guestContext.addInitScript(() => localStorage.setItem("lounge-test-identity", "guest"));
  await Promise.all([installStableMediaRoutes(fanContext), installStableMediaRoutes(guestContext)]);
  const fan = await fanContext.newPage(), guest = await guestContext.newPage();
  activePage = fan;
  watch(fan); watch(guest);

  async function verifyMatrix(matrixLocales, widths) {
    for (const locale of matrixLocales) for (const width of widths) {
      await fan.setViewportSize({ width, height: width <= 390 ? 900 : 1000 });
      for (const [surface, url, selector] of [
        ["board", boardUrl(locale), "[data-unified-feed]"],
        ["media", mediaUrl(locale), "#celebrity-content"],
      ]) {
        await fan.goto(url, { waitUntil: "domcontentloaded" });
        await settle(fan, selector);
        if (surface === "board") await expect(fan.locator("[data-post-id]")).toHaveCount(2);
        else await expect.poll(() => fan.locator("[data-media-kind]").count()).toBeGreaterThanOrEqual(1);
        await waitForLoadedImages(fan, `${surface === "board" ? "[data-unified-feed]" : "[data-media-kind]"} img`, true);
        await assertNoOverflow(fan, url);
        assert.equal(evidence.pageErrors.length, 0, `${url} emitted an uncaught application error`);
        evidence.matrix.push({ locale, width, surface, status: "passed" });
        if (width === 768 && (locale === "ja" || locale === "th")) await snap(fan, `${surface}-${locale}-${width}.png`);
      }
    }
  }
  await verifyMatrix(locales, [390, 1440]);
  await verifyMatrix(compactLocales, [360, 768]);
  pass("board and media render without horizontal overflow in all 11 locales at 390/1440 and KO/JA/VI/TH at 360/768");

  for (const [tab, label] of [["home", "홈"], ["board", "게시판"], ["certifications", "찐팬 인증"], ["events", "이벤트"], ["leaderboard", "팬 리더보드"]]) {
    await goto(fan, `${harness.baseURL}/elina?tab=${tab}&locale=ko#celebrity-content`, "#celebrity-content");
    await expect(fan.getByRole("navigation", { name: "엘리나 팬페이지 메뉴" }).getByRole("link", { name: new RegExp(label) })).toHaveAttribute("aria-current", "page");
  }
  pass("all five primary destinations preserve their active state inside the fan-page shell");

  await fan.setViewportSize({ width: 1440, height: 1000 });
  await goto(fan, boardUrl("ko"), "[data-unified-feed]");
  await expect(fan.locator('[data-feed-kind="notice"]')).toHaveCount(3);
  await expect(fan.getByRole("link", { name: "새 촬영 현장에서 전하는 소식", exact: true })).toBeVisible();
  await expect(fan.locator("[data-post-id]")).toHaveCount(2);
  await expect(fan.locator("[data-cheer-id]")).toHaveCount(1);
  await expect(fan.getByRole("button", { name: "글 쓰기" })).toHaveCount(1);
  const alignment = await fan.evaluate(() => {
    const nav = document.querySelector("#celebrity-content")?.getBoundingClientRect();
    const feed = document.querySelector("[data-unified-feed]")?.getBoundingClientRect();
    return nav && feed ? { left: Math.abs(nav.left - feed.left), right: Math.abs(nav.right - feed.right) } : null;
  });
  assert(alignment && alignment.left <= 1 && alignment.right <= 1, `navigation/feed alignment drifted: ${JSON.stringify(alignment)}`);
  evidence.measurements.desktopAlignment = alignment;
  await expect(fan.getByRole("img", { name: "첨부 사진" })).toHaveCount(2);
  await expect(fan.getByRole("img", { name: "엘리나 공식 촬영 현장" })).toHaveCount(1);
  const contentImages = await fan.getByRole("img", { name: /첨부 사진|엘리나 공식 촬영 현장/ }).evaluateAll(nodes => nodes.map(node => node.currentSrc || node.getAttribute("src")));
  assert.equal(new Set(contentImages).size, 3, "normal feed fixtures must render three distinct content images");
  await snap(fan, "board-all-ko-1440.png");
  await fan.setViewportSize({ width: 390, height: 900 });
  await goto(fan, boardUrl("ko"), "[data-unified-feed]");
  await snap(fan, "board-all-ko-390.png");
  pass("normal unified feed contains official, fan and legacy content, one composer, three distinct images and aligned full-width edges");

  await goto(fan, boardUrl("ko", "official"), "[data-unified-feed]");
  assert((await fan.locator('[data-feed-kind="notice"]').count()) >= 2);
  await expect(fan.locator("[data-post-id], [data-cheer-id]")).toHaveCount(0);
  await expect(fan.getByRole("button", { name: "글 쓰기" })).toHaveCount(0);
  await goto(fan, boardUrl("ko", "fans"), "[data-unified-feed]");
  await expect(fan.locator('[data-feed-kind="notice"]')).toHaveCount(0);
  await expect(fan.locator("[data-post-id]")).toHaveCount(2);
  await expect(fan.locator("[data-cheer-id]")).toHaveCount(1);
  pass("source filters expose only the expected official or fan-authored item kinds");

  await goto(fan, mediaUrl("ko"), "#celebrity-content");
  await expect.poll(() => fan.locator("[data-media-kind]").count()).toBeGreaterThanOrEqual(1);
  let internalMediaLink = fan.locator('[data-media-kind="photos"] a[href^="/"]').first();
  await expect(internalMediaLink).toBeVisible();
  assert.equal(new URL(await internalMediaLink.getAttribute("href"), harness.baseURL).searchParams.get("returnTo"), routePath(mediaUrl("ko")));
  await fan.getByRole("button", { name: "사진" }).click();
  await expect.poll(() => routePath(fan.url())).toBe(routePath(mediaUrl("ko", "photos")));
  internalMediaLink = fan.locator('[data-media-kind="photos"] a[href^="/"]').first();
  assert.equal(new URL(await internalMediaLink.getAttribute("href"), harness.baseURL).searchParams.get("returnTo"), routePath(mediaUrl("ko", "photos")));
  await internalMediaLink.click();
  await settle(fan, "#notice-detail-main");
  await expect(fan.getByRole("link", { name: "돌아가기" }).first()).toHaveAttribute("href", routePath(mediaUrl("ko", "photos")));
  pass("internal media details retain all and filtered media origins while filter URLs keep the canonical board anchor");

  await goto(guest, boardUrl("ko"), "[data-unified-feed]");
  await expect(guest.getByRole("button", { name: "글 쓰기" })).toHaveCount(0);
  await expect(guest.locator("[data-unified-feed]").getByRole("link", { name: /로그인/ })).toBeVisible();
  await goto(fan, boardUrl("ko"), "[data-unified-feed]");
  await expect(fan.getByRole("button", { name: "글 쓰기" })).toHaveCount(1);
  pass("guest and authenticated owner states expose the correct feed entry action");

  const canonicalReturn = "/elina?tab=board&locale=ko#celebrity-content";
  const noticeLink = fan.getByRole("link", { name: "새 촬영 현장에서 전하는 소식", exact: true });
  const noticeHref = await noticeLink.getAttribute("href");
  assert.equal(new URL(noticeHref, harness.baseURL).searchParams.get("returnTo"), canonicalReturn);
  await noticeLink.click();
  await settle(fan, "#notice-detail-main");
  await expect(fan.getByRole("link", { name: "돌아가기" }).first()).toHaveAttribute("href", canonicalReturn);
  await goto(fan, boardUrl("ko"), "[data-unified-feed]");
  const post = fan.locator(`[data-post-id="${fixture.fanPost.id}"]`);
  const detailLink = post.getByRole("link", { name: /댓글/ });
  assert.equal(new URL(await detailLink.getAttribute("href"), harness.baseURL).searchParams.get("returnTo"), canonicalReturn);
  await detailLink.click();
  await settle(fan, "#fan-post-main");
  await expect(fan.getByRole("link", { name: "돌아가기" }).first()).toHaveAttribute("href", canonicalReturn);
  pass("notice and fan-post details retain the canonical board return target");

  await fan.setViewportSize({ width: 390, height: 900 });
  await goto(fan, boardUrl("ko", "fans"), "[data-unified-feed]");
  await snap(fan, "board-long-nickname-ko-390.png");
  const cheer = fan.locator(`[data-cheer-id="${fixture.cheerId}"]`);
  const more = cheer.getByRole("button", { name: "더 보기" });
  await more.focus();
  await fan.keyboard.press("Enter");
  const removeItem = fan.getByRole("menuitem", { name: "삭제" });
  await expect(removeItem).toBeFocused();
  await snap(fan, "board-owner-menu-focus-ko-390.png", false);
  await fan.keyboard.press("Enter");
  const dialog = fan.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  await snap(fan, "board-delete-dialog-focus-ko-390.png", false);
  await fan.keyboard.press("Escape");
  await expect(more).toBeFocused();
  pass("keyboard opens the owner menu and delete dialog, focuses Cancel and restores focus on Escape");

  await fan.setViewportSize({ width: 1440, height: 1000 });
  await goto(fan, mediaUrl("ko"), "#celebrity-content");
  await expect(fan.getByRole("heading", { name: "사진 · 영상" })).toBeVisible();
  await snap(fan, "media-normal-ko-1440.png");
  await fan.setViewportSize({ width: 390, height: 900 });
  await goto(fan, mediaUrl("ko"), "#celebrity-content");
  await snap(fan, "media-normal-ko-390.png");

  async function emptyMediaRoutes(page, instagramStatus = 200) {
    await page.route("**/api/celebrities/elina/media?*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }));
    await page.route("**/api/celebrities/elina/instagram", route => route.fulfill({ status: instagramStatus, contentType: "application/json", body: instagramStatus === 200 ? JSON.stringify({ items: [], updatedAt: null }) : JSON.stringify({ error: { code: "LOCAL_SOURCE_FAILURE" } }) }));
  }
  await emptyMediaRoutes(fan);
  await goto(fan, mediaUrl("ko", "videos"), "#celebrity-content");
  await expect(fan.getByRole("button", { name: "전체 보기" })).toBeVisible();
  await snap(fan, "media-filtered-empty-ko-390.png");
  await fan.getByRole("button", { name: "전체 보기" }).click();
  await expect(fan).toHaveURL(mediaUrl("ko"));
  await expect(fan.getByRole("link", { name: "피드" })).toBeVisible();
  await fan.setViewportSize({ width: 1440, height: 1000 });
  await snap(fan, "media-all-empty-ko-1440.png");
  await fan.unroute("**/api/celebrities/elina/media?*");
  await fan.unroute("**/api/celebrities/elina/instagram");
  const partialFailureUrl = new URL(mediaUrl("ko"));
  partialFailureUrl.searchParams.set("partialError", "1");
  await goto(fan, partialFailureUrl.href, "#celebrity-content");
  await expect(fan.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(fan.locator("[data-media-kind] img").first(), "successful official media remains during a source failure").toBeVisible();
  await snap(fan, "media-source-failure-ko-1440.png");
  await fan.unroute("**/api/celebrities/elina/instagram");
  pass("media filtered-empty, all-empty and partial source-failure states preserve their intended recovery actions and successful content");

  for (const [page, width] of [[fan, 1440], [guest, 390]]) {
    await page.setViewportSize({ width, height: width === 390 ? 900 : 1000 });
    await goto(page, boardUrl("ko"), "[data-unified-feed]");
    await expect(page.locator("[data-post-id]")).toHaveCount(2);
    await waitForLoadedImages(page, "[data-unified-feed] img", true);
    const audit = await new AxeBuilder({ page }).include("#celebrity-detail-main").withTags(["wcag2a", "wcag2aa"]).analyze();
    evidence.axe.push({ width, violations: audit.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })) });
    assert.deepEqual(audit.violations, [], `axe violations at ${width}px: ${audit.violations.map(item => item.id).join(", ")}`);
  }
  assert.deepEqual(evidence.pageErrors, []);
  pass("Korean desktop and mobile active content pass axe WCAG A/AA with no uncaught application errors");

  if (process.env.UNIFIED_FEED_PREVIEW === "1") {
    const preview = { url: boardUrl("ko"), pid: process.pid };
    await Promise.all([
      writeFile(previewFile, JSON.stringify(preview, null, 2)),
      writeFile(evidenceFile, JSON.stringify(evidence, null, 2)),
    ]);
    console.log(`PREVIEW ${preview.url} pid=${preview.pid} (send SIGUSR1 to finish)`);
    await new Promise(resolve => process.once("SIGUSR1", resolve));
  }
} catch (error) {
  evidence.failure = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  if (activePage && !activePage.isClosed()) {
    try { await snap(activePage, "failure.png"); } catch (screenshotError) { evidence.failure.screenshotError = String(screenshotError); }
  }
  throw error;
} finally {
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
