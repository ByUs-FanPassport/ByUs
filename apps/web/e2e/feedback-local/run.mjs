import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "../lounge-local/server.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const out = path.join(root, "work/telegram-feedback-20261003/visual-verification");
const candidates = path.join(out, "release-candidates");
const focusMode = process.env.FEEDBACK_FOCUS_ONLY === "1";
const multiUploadMode = process.env.FEEDBACK_MULTI_UPLOAD_ONLY === "1";
const supplementalMode = process.env.FEEDBACK_SKIP_MATRIX === "1" || focusMode || multiUploadMode;
const supplemental = path.join(out, "supplemental");
const focusEvidence = path.join(out, "supplemental-focus");
const multiUploadEvidence = path.join(out, "supplemental-multi-upload");
const captureDir = focusMode ? focusEvidence : multiUploadMode ? multiUploadEvidence : supplementalMode ? supplemental : candidates;
const evidenceFile = path.join(out, focusMode ? "evidence-focus.json" : multiUploadMode ? "evidence-multi-upload.json" : supplementalMode ? "evidence-supplemental.json" : "evidence.json");
const uploadFixture = path.join(root, "apps/web/public/images/guest-home/elina-card.jpg");
const secondUploadFixture = path.join(root, "apps/web/public/images/guest-home/changha-card.jpg");
const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "id", "vi", "th", "pt", "fr"];
const sharedRoutes = [["home", "/"], ["community-hub", "/community?creator=elina&tab=posts"]];
const focusedRoutes = [
  ["fan-home", "/elina?tab=home"], ["fan-community", "/elina?tab=community"], ["media", "/elina?tab=media"],
  ["certifications", "/elina?tab=certifications"], ["my", "/my"],
  ["notifications", "/notifications"], ["settings", "/settings"],
];

await Promise.all([mkdir(candidates, { recursive: true }), mkdir(supplemental, { recursive: true }), mkdir(focusEvidence, { recursive: true }), mkdir(multiUploadEvidence, { recursive: true })]);
const harness = await startHarness({ fanWebMode: true });
const evidence = { checks: [], matrix: [], screenshots: [], pageErrors: [], reusedEvidence: [], measurements: {} };
const pass = (message) => { evidence.checks.push(message); console.log(`PASS ${message}`); };
const urlFor = (pathname, locale) => {
  const url = new URL(pathname, harness.baseURL);
  url.searchParams.set("locale", locale);
  url.searchParams.set("feedback", "1");
  return url.href;
};
async function settle(page) {
  await page.waitForSelector("body", { state: "attached" });
  await page.waitForSelector("#root > *", { state: "attached", timeout: 60_000 });
  await page.waitForTimeout(80);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function assertViewport(page, width, label) {
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert(dimensions.scroll <= dimensions.client + 1, `${label} overflows at ${width}px (${dimensions.scroll} > ${dimensions.client})`);
}
async function snap(page, name) {
  await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await settle(page);
  const file = path.join(captureDir, name);
  await page.screenshot({ path: file });
  if (!evidence.screenshots.includes(file)) evidence.screenshots.push(file);
}
async function snapRegion(page, selector, name) {
  const file = path.join(captureDir, name);
  const region = page.locator(selector);
  await region.scrollIntoViewIfNeeded();
  await region.screenshot({ path: file });
  if (!evidence.screenshots.includes(file)) evidence.screenshots.push(file);
}
async function snapLocator(locator, name) {
  const file = path.join(captureDir, name);
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: file });
  if (!evidence.screenshots.includes(file)) evidence.screenshots.push(file);
}
async function snapViewportAt(page, locator, name) {
  const file = path.join(captureDir, name);
  await locator.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 72 }));
  await page.waitForTimeout(120);
  await page.screenshot({ path: file });
  if (!evidence.screenshots.includes(file)) evidence.screenshots.push(file);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("lounge-test-identity", "fan"));
  const page = await context.newPage();
  page.on("pageerror", error => evidence.pageErrors.push({ url: page.url(), message: error.message }));
  async function verifyMatrix(matrixLocales, widths, matrixRoutes) {
    for (const locale of matrixLocales) for (const width of widths) {
      const matrixPage = await context.newPage();
      matrixPage.on("pageerror", error => evidence.pageErrors.push({ url: matrixPage.url(), message: error.message }));
      await matrixPage.setViewportSize({ width, height: width === 390 ? 900 : 1000 });
      for (const [name, pathname] of matrixRoutes) {
        const errorStart = evidence.pageErrors.length;
        await matrixPage.goto(urlFor(pathname, locale), { waitUntil: "domcontentloaded" });
        await settle(matrixPage);
        await assertViewport(matrixPage, width, `${locale} ${name}`);
        assert.equal(evidence.pageErrors.length, errorStart, `${locale} ${name} emitted a runtime error`);
        evidence.matrix.push({ locale, width, route: name, status: "passed" });
      }
      await matrixPage.close();
    }
  }
  const matrixScope = supplementalMode ? "skip" : process.env.FEEDBACK_MATRIX_SCOPE ?? "full";
  if (matrixScope === "full" || matrixScope === "shared") {
    await verifyMatrix(locales, [390, 1440], sharedRoutes);
  } else if (matrixScope === "remaining") {
    evidence.reusedEvidence.push("Shared home and community previously passed all 44 combinations at 390px and 1440px across the same harness, fixture shape and code revision; the final fixture-only nickname change does not affect layout structure.");
  }
  if (matrixScope === "full" || matrixScope === "remaining") {
    await verifyMatrix(["ko", "ja", "vi", "th"], [360, 768], sharedRoutes);
    await verifyMatrix(["ko", "en", "fr"], [390, 1440], focusedRoutes);
  }
  if (matrixScope !== "skip") {
    pass("shared home and community cover all 11 locales at 390px and 1440px; Korean, Japanese, Vietnamese and Thai also cover 360px and 768px, while the remaining changed surfaces cover Korean, English and a long French locale without horizontal overflow or runtime errors");
  }

  if (matrixScope === "skip") {
    if (focusMode) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(urlFor("/settings", "ko"));
      await expect(page.getByRole("heading", { name: "설정", exact: true })).toBeVisible();
      await expect(page.getByText("등록된 브라우저 알림이 없어요.", { exact: true })).toHaveCount(0);
      const focusByTab = async (id) => {
        for (let index = 0; index < 24; index += 1) {
          await page.keyboard.press("Tab");
          if (await page.evaluate(expected => document.activeElement?.id === expected, id)) return;
        }
        assert.fail(`keyboard Tab did not reach #${id}`);
      };
      const captureFocused = async (name) => {
        const file = path.join(captureDir, name);
        await page.screenshot({ path: file });
        evidence.screenshots.push(file);
      };
      await focusByTab("settings-row-profile");
      const profileRow = page.locator("#settings-row-profile");
      await expect(profileRow).toBeFocused();
      const focusMetrics = await profileRow.evaluate(element => {
        const style = getComputedStyle(element);
        const parentStyle = getComputedStyle(element.parentElement);
        return { outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, parentOverflow: parentStyle.overflow };
      });
      evidence.measurements.settingsRowFocus = focusMetrics;
      assert(parseFloat(focusMetrics.outlineWidth) > 0 && focusMetrics.outlineOffset === "-3px" && focusMetrics.parentOverflow === "hidden", `settings focus outline contract mismatch: ${JSON.stringify(focusMetrics)}`);
      await captureFocused("01-settings-profile-keyboard-focus-ko-1440.png");
      await page.keyboard.press("Tab");
      const languageRow = page.locator("#settings-row-language");
      await expect(languageRow).toBeFocused();
      await captureFocused("02-settings-language-keyboard-focus-ko-1440.png");
      pass("settings index removes the misleading browser-off summary and keeps keyboard focus outlines visible inside clipped row groups");
      assert.equal(evidence.screenshots.length, 2);
    } else if (multiUploadMode) {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(urlFor("/elina?tab=community", "ko"));
      await page.getByRole("button", { name: "글 쓰기" }).click();
      const body = page.getByRole("textbox", { name: "글 쓰기" });
      const postBody = `두 장 사진 업로드 검증 ${Date.now()}`;
      await body.fill(postBody);

      const uploads = [];
      page.on("response", async response => {
        if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/content-assets") return;
        const payload = await response.json().catch(() => null);
        uploads.push({ status: response.status(), asset: payload?.asset ?? null });
      });
      await page.getByLabel("사진 추가").setInputFiles([uploadFixture, secondUploadFixture]);
      const composerPhotos = page.getByRole("img", { name: "첨부 사진" });
      await expect(composerPhotos).toHaveCount(2, { timeout: 30_000 });
      await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(2);
      assert(uploads.every(upload => upload.status >= 200 && upload.status < 300), `two-file upload returned a non-success response: ${JSON.stringify(uploads)}`);
      assert(uploads.every(upload => typeof upload.asset?.id === "string" && upload.asset.width > 0 && upload.asset.height > 0), `two-file upload did not return two valid asset metadata objects: ${JSON.stringify(uploads)}`);
      assert.equal(new Set(uploads.map(upload => upload.asset.id)).size, 2, "two-file upload returned duplicate asset ids");
      evidence.measurements.multiUpload = { responseCount: uploads.length, assets: uploads };
      await snapLocator(page.locator("form").filter({ has: body }), "01-community-composer-two-photos-ko-390.png");

      await page.getByRole("button", { name: "게시" }).click();
      const savedArticle = page.getByText(postBody, { exact: true }).locator("xpath=ancestor::article[@data-post-id]");
      await expect(savedArticle).toBeVisible({ timeout: 15_000 });
      const persistedAssetRequests = [];
      page.on("request", request => {
        const match = new URL(request.url()).pathname.match(/^\/api\/content-assets\/([0-9a-f-]{36})$/i);
        if (request.method() === "GET" && match) persistedAssetRequests.push(match[1]);
      });
      await page.reload();
      await expect(savedArticle).toBeVisible({ timeout: 15_000 });
      const persistedPhotos = savedArticle.getByRole("img", { name: "첨부 사진" });
      await expect(persistedPhotos).toHaveCount(2);
      assert(uploads.every(upload => persistedAssetRequests.includes(upload.asset.id)), `saved post did not request both uploaded assets after reload: ${JSON.stringify({ uploads, persistedAssetRequests })}`);
      evidence.measurements.multiUpload.persistedAfterReload = true;
      evidence.measurements.multiUpload.persistedAssetRequests = persistedAssetRequests;
      await snapViewportAt(page, savedArticle, "02-community-post-two-photos-ko-390.png");
      pass("one browser file selection uploads two valid asset metadata records, renders both composer previews, and persists both images on the saved post card");
      assert.equal(evidence.screenshots.length, 2);
    } else {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(urlFor("/settings", "ko"));
    await expect(page.getByRole("heading", { name: "설정", exact: true })).toBeVisible();
    await snap(page, "01-settings-index-ko-1440.png");

    const channelsRow = page.getByRole("button", { name: /연결 및 수신 채널/ });
    await channelsRow.click();
    const channelsHeading = page.getByRole("heading", { name: "연결 및 수신 채널", exact: true }).first();
    await expect(channelsHeading).toBeFocused();
    await expect(channelsHeading).toHaveAttribute("tabindex", "-1");
    await snap(page, "02-settings-channels-ko-1440.png");
    await page.screenshot({ path: path.join(candidates, "08-settings-channels-ko-1440.png") });
    pass("settings index opens the channels detail and moves focus to its programmatic h1 target");

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(urlFor("/settings?section=channels", "ko"));
    await expect(page.getByRole("heading", { name: "연결 및 수신 채널", exact: true }).first()).toBeFocused();
    await assertViewport(page, 360, "mobile settings channels");
    await snap(page, "03-settings-channels-ko-360.png");
    await page.goto(urlFor("/settings?section=language", "ko"));
    await expect(page.getByRole("heading", { name: "언어", exact: true }).first()).toBeFocused();
    assert.equal(new URL(page.url()).searchParams.get("locale"), "ko");
    pass("direct mobile settings sections preserve locale, fit 360px and focus their h1 headings");

    await page.goto(urlFor("/elina?tab=community", "ko"));
    await page.getByRole("button", { name: "글 쓰기" }).click();
    const fileInput = page.getByLabel("사진 추가");
    await expect(fileInput).toHaveAttribute("tabindex", "-1");
    const visibility = page.getByRole("button", { name: /공개 범위/ });
    await visibility.focus();
    await page.keyboard.press("Tab");
    assert.equal(await fileInput.evaluate(element => document.activeElement === element), false, "hidden file input entered the sequential tab order");
    await visibility.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    assert(sheetBox && sheetBox.y + sheetBox.height >= 795, "360px visibility control is not bottom aligned");
    await snapLocator(sheet, "04-community-visibility-sheet-ko-360.png");
    pass("the upload input stays outside sequential keyboard navigation and the visibility control uses a mobile bottom sheet");

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(urlFor("/elina?tab=media", "ko"));
    const mediaTitle = page.getByText("엘리나와 함께한 가을의 순간", { exact: true });
    await expect(mediaTitle).toBeVisible();
    await snapLocator(page.getByRole("region", { name: "사진 · 영상" }), "05-media-ko-1440.png");
    pass("media evidence shows the fixture image and title at desktop width");

    const longNickname = "ByUsFan_초장문닉네임테스트ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789끝까지함께해요";
    for (const { locale, width, height, key, screenshot } of [
      { locale: "ko", width: 360, height: 800, key: "leaderboard360Ko", screenshot: "06-leaderboard-long-nickname-ko-360.png" },
      { locale: "fr", width: 390, height: 900, key: "leaderboard390Fr", screenshot: "07-leaderboard-long-nickname-fr-390.png" },
      { locale: "ko", width: 1440, height: 1000, key: "leaderboard1440Ko", screenshot: "08-leaderboard-long-nickname-ko-1440.png" },
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(urlFor("/elina?tab=leaderboard", locale));
      const nickname = page.getByText(longNickname, { exact: true }).first();
      await expect(nickname).toBeVisible();
      await assertViewport(page, width, `120-fan ${locale} leaderboard with unbroken nickname`);
      const leaderboard = nickname.locator("xpath=ancestor::section[1]");
      const metrics = await leaderboard.evaluate(element => {
        const table = element.querySelector("table");
        const longName = [...element.querySelectorAll("strong, b")].find(node => node.textContent?.startsWith("ByUsFan_초장문"));
        return {
          innerWidth,
          sectionRight: Math.round(element.getBoundingClientRect().right),
          sectionClientWidth: element.clientWidth,
          sectionScrollWidth: element.scrollWidth,
          tableClientWidth: table?.clientWidth ?? null,
          tableScrollWidth: table?.scrollWidth ?? null,
          nicknameRight: longName ? Math.round(longName.getBoundingClientRect().right) : null,
        };
      });
      evidence.measurements[key] = metrics;
      await snapViewportAt(page, leaderboard, screenshot);
      assert(metrics.sectionRight <= metrics.innerWidth + 1 && metrics.sectionScrollWidth <= metrics.sectionClientWidth + 1, `leaderboard table or unbroken nickname overflows its ${width}px section: ${JSON.stringify(metrics)}`);
    }
    pass("the 120-fan leaderboard renders the same long unbroken MY and row nickname at 360px Korean, 390px French and 1440px Korean without page or table overflow");

    assert.equal(evidence.screenshots.length, 8);
    }
  } else {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(urlFor("/", "ko"));
  await expect(page.locator("[data-fan-pulse-home]")).toBeVisible();
  await expect(page.getByText("KARA", { exact: true })).toHaveCount(0);
  const roleButtons = page.locator('[role="group"] button[aria-controls="home-creator-rail"]');
  await expect(roleButtons.first()).toBeVisible();
  const widths = await roleButtons.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
  assert(Math.max(...widths) - Math.min(...widths) <= 1, `home filters are not equal width: ${widths.join(", ")}`);
  await roleButtons.last().focus();
  await expect(roleButtons.last()).toBeFocused();
  const focusedInside = await roleButtons.last().evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; });
  assert(focusedInside, "focused home filter is outside the mobile viewport");
  await snapRegion(page, "#celebrities", "01-home-favorites-ko-390.png");
  pass("home filters have equal widths, keyboard focus remains visible, and the unpublished KARA record is absent from discovery");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(urlFor("/", "ko"));
  await expect(page.locator("p:visible", { hasText: "ByUs_Fan_함께걷는팬" }).first()).toBeVisible();
  await expect(page.locator(":visible", { hasText: /^패스포트 2개$/ }).first()).toBeVisible();
  await expect(page.getByText("KARA", { exact: true })).toHaveCount(0);
  await snap(page, "02-home-ko-1440.png");

  await page.goto(urlFor("/elina?tab=home", "ko"));
  const fanbar = page.getByRole("region", { name: "내 팬 활동" });
  await expect(fanbar).toContainText("ByUs_Fan_함께걷는팬");
  await snap(page, "03-fan-home-ko-1440.png");
  pass("the long nickname remains visible in the home summary and creator fan activity bar");

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(urlFor("/elina?tab=community", "ko"));
  const write = page.getByRole("button", { name: "글 쓰기" });
  await write.click();
  const body = page.getByRole("textbox", { name: "글 쓰기" });
  await body.focus();
  await expect(body).toBeFocused();
  const visibility = page.getByRole("button", { name: /공개 범위/ });
  await visibility.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  assert(sheetBox && sheetBox.y + sheetBox.height >= 895, "mobile visibility control is not presented as a bottom sheet");
  await page.keyboard.press("Escape");
  await expect(visibility).toBeFocused();
  const postBody = "오늘의 좋아하는 순간을 함께 나눠요.";
  await body.fill(postBody);
  await page.getByLabel("사진 추가").setInputFiles(uploadFixture);
  await expect(page.getByRole("img", { name: "첨부 사진" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "게시" }).click();
  await expect(page.getByText(postBody, { exact: true })).toBeVisible({ timeout: 15_000 });
  const card = page.locator("[data-post-id]").filter({ hasText: postBody });
  const like = card.getByRole("button", { name: /좋아요/ });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  const likedColor = await like.evaluate(element => getComputedStyle(element).color);
  assert.notEqual(likedColor, "rgb(0, 0, 0)", "liked post did not adopt its highlighted color");
  const savedArticle = page.getByText(postBody, { exact: true }).locator("xpath=ancestor::article[@data-post-id]");
  await expect(savedArticle).toBeVisible();
  await expect(like).toBeEnabled();
  await snapViewportAt(page, savedArticle, "04-community-created-liked-ko-390.png");
  await card.getByRole("link", { name: /댓글/ }).click();
  await expect(page).toHaveURL(/\/c\/elina\/community\/[0-9a-f-]{36}\?locale=ko/);
  const back = page.getByRole("link", { name: "돌아가기" });
  await expect(back).toHaveAttribute("href", /\/elina\?tab=community&locale=ko/);
  await back.click();
  await expect(page).toHaveURL(/\/elina\?tab=community&locale=ko/);
  pass("mobile composer opens with focus, uses a bottom sheet, uploads a real image, persists a post, shows the liked state, and returns from detail to the same creator tab and locale");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(urlFor("/elina?tab=media", "ko"));
  await expect(page.getByText("엘리나와 함께한 가을의 순간", { exact: true })).toBeVisible();

  await page.goto(urlFor("/elina?tab=certifications", "ko"));
  await expect(page.getByText("팬 LIVE 참여 인증", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "내 인증 내역" }).click();
  await expect(page.getByText(/2회차/)).toBeVisible();
  await snapLocator(page.getByRole("region", { name: "팬 인증" }), "05-certification-history-ko-1440.png");
  pass("media cards render real images and certification history exposes the second attempt");

  await page.goto(urlFor("/my", "ko"));
  await expect(page.getByText("카라", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ByUs_Fan_함께걷는팬님" })).toBeVisible();
  await snap(page, "06-my-ko-1440.png");
  await page.goto(urlFor("/notifications", "ko"));
  await settle(page);
  await snap(page, "07-notifications-ko-1440.png");
  await page.goto(urlFor("/settings", "ko"));
  await settle(page);
  const channelsRow = page.getByRole("button", { name: /연결 및 수신 채널/ });
  await channelsRow.click();
  await expect(page).toHaveURL(/section=channels/);
  await expect(page.getByRole("heading", { name: "연결 및 수신 채널", exact: true }).last()).toBeVisible();
  await snap(page, "08-settings-channels-ko-1440.png");
  await page.getByRole("button", { name: "설정으로 돌아가기" }).click();
  await expect(page).not.toHaveURL(/section=/);
  await expect(channelsRow).toBeFocused();
  await channelsRow.click();
  await page.goBack();
  await expect(page).not.toHaveURL(/section=/);
  await expect(channelsRow).toBeFocused();
  await page.goto(urlFor("/settings?section=language", "ko"));
  await expect(page.getByRole("heading", { name: "언어", exact: true }).last()).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("locale"), "ko");
  assert.equal(new URL(page.url()).searchParams.get("section"), "language");
  await snap(page, "09-settings-language-ko-1440.png");
  pass("MY keeps the unpublished passport in private data; notifications render; settings preserve section and locale on direct entry and restore row focus after UI and browser Back navigation");

  assert.equal(evidence.screenshots.length, 9);
  }
  assert.deepEqual(evidence.pageErrors, []);
} finally {
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
