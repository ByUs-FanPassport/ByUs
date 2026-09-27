import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "../lounge-local/server.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const out = path.join(root, "work/community-verification");
const uploadFixture = path.join(root, "apps/web/public/images/guest-home/elina-card.jpg");
await mkdir(out, { recursive: true });

const harness = await startHarness({ fanWebMode: true });
const evidence = { checks: [], screenshots: [], requests: [] };
const pass = (message) => { evidence.checks.push(message); console.log(`PASS ${message}`); };
async function api(actor, pathname, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(harness.baseURL + pathname, {
    method,
    headers: {
      ...(actor ? { authorization: `Bearer lounge-local-${actor}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}
async function screenshot(page, name, fullPage = true) {
  const target = path.join(out, name);
  await page.screenshot({ path: target, fullPage });
  evidence.screenshots.push(target);
}
async function assertNoOverflow(page, width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${width}px horizontal overflow`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fanContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fanContext.addInitScript(() => localStorage.setItem("lounge-test-identity", "fan"));
  const guest = await guestContext.newPage();
  const fan = await fanContext.newPage();
  const errors = [];
  for (const page of [guest, fan]) {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) evidence.requests.push(`${request.method()} ${url.pathname}${url.search}`);
    });
    await page.route("**/api/celebrities/*/certifications?*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ certifications: [] }) }));
  }

  const hub = "/community?creator=elina&tab=posts&locale=ko";
  await guest.goto(harness.baseURL + hub);
  await expect(guest.getByRole("heading", { name: "커뮤니티", exact: true })).toBeVisible();
  const login = guest.getByRole("link", { name: "로그인하고 참여하기" });
  await expect(login).toBeVisible();
  const loginUrl = new URL(await login.getAttribute("href"), harness.baseURL);
  assert.equal(loginUrl.pathname, "/login");
  assert.equal(loginUrl.searchParams.get("returnTo"), hub);
  pass("guest login returns to the selected creator community hub");

  for (const width of [320, 768, 1024, 1440]) {
    await guest.setViewportSize({ width, height: width === 320 ? 760 : 900 });
    await guest.goto(harness.baseURL + hub);
    await expect(guest.getByRole("heading", { name: "커뮤니티", exact: true })).toBeVisible();
    await assertNoOverflow(guest, width);
    await screenshot(guest, `community-ko-${width}.png`);
  }
  pass("CommunityScreen renders at 320, 768, 1024 and 1440px without horizontal overflow");

  await fan.goto(harness.baseURL + hub);
  await fan.getByRole("button", { name: "글 쓰기" }).click();
  const postBody = `로컬 커뮤니티 사진 게시물 ${Date.now()}`;
  await fan.getByRole("textbox", { name: "글 쓰기" }).fill(postBody);
  await fan.getByLabel("사진 추가").setInputFiles(uploadFixture);
  await expect(fan.getByRole("img", { name: "첨부 사진" })).toBeVisible({ timeout: 15_000 });
  await fan.getByRole("button", { name: "게시" }).click();
  await expect(fan.getByText(postBody, { exact: true })).toBeVisible({ timeout: 15_000 });
  const posts = await api("fan", "/api/celebrities/elina/posts?locale=ko");
  assert.equal(posts.status, 200);
  const saved = posts.data.items.find(post => post.body === postBody);
  assert(saved && saved.celebritySlug === "elina" && saved.assets.length === 1);
  const asset = await fetch(`${harness.baseURL}/api/content-assets/${saved.assets[0].id}`, { headers: { authorization: "Bearer lounge-local-fan" } });
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/webp");
  pass("authenticated fan uploads a real image and saves a creator-scoped post through real handlers and PostgreSQL");

  const savedCard = fan.locator(`[data-post-id="${saved.id}"]`);
  await savedCard.getByRole("link", { name: /댓글/ }).click();
  await expect(fan).toHaveURL(new RegExp(`/c/elina/community/${saved.id}\\?locale=ko$`));
  const comment = `커뮤니티 상세 댓글 ${Date.now()}`;
  await fan.getByRole("textbox", { name: "댓글 쓰기" }).fill(comment);
  await fan.getByRole("button", { name: "등록" }).click();
  await expect(fan.getByText(comment, { exact: true })).toBeVisible({ timeout: 10_000 });
  const back = fan.getByRole("link", { name: "돌아가기" });
  await expect(back).toHaveAttribute("href", hub);
  await back.click();
  await expect(fan).toHaveURL(new RegExp(`/community\\?creator=elina&tab=posts&locale=ko$`));
  pass("post detail comment persists and Back returns to /community with creator, tab and locale");

  const privateBody = `비공개 패스포트 게시물 ${Date.now()}`;
  const privatePost = await api("other", "/api/celebrities/elina/posts", { body: privateBody, visibility: "members", assetIds: [], idempotencyKey: crypto.randomUUID() });
  assert.equal(privatePost.status, 201);
  const guestPosts = await api(null, "/api/celebrities/elina/posts?locale=ko");
  assert.equal(guestPosts.status, 200);
  assert.equal(guestPosts.data.items.some(post => post.body === privateBody), false);

  const moderatedBody = `신고 후 숨김 게시물 ${Date.now()}`;
  const moderatedPost = await api("other", "/api/celebrities/elina/posts", { body: moderatedBody, visibility: "public", assetIds: [], idempotencyKey: crypto.randomUUID() });
  assert.equal(moderatedPost.status, 201);
  const report = await api("fan", "/api/content-reports", { targetType: "fan_post", targetId: moderatedPost.data.id, reason: "로컬 커뮤니티 신고 검증", idempotencyKey: crypto.randomUUID() });
  assert.equal(report.status, 200);
  const resolution = await api("admin", `/api/admin/content-reports/${report.data.id}`, { resolution: "resolved", hideTarget: true, reason: "로컬 커뮤니티 운영 정책 위반 숨김 검증" });
  assert.equal(resolution.status, 200);
  const afterModeration = await api(null, "/api/celebrities/elina/posts?locale=ko");
  assert.equal(afterModeration.data.items.some(post => post.body === moderatedBody), false);
  pass("Passport privacy and existing report moderation hide protected content from guests");

  await fan.goto(harness.baseURL + "/community?creator=elina&tab=fans&locale=ko");
  await expect(fan.getByText(/501명부터/)).toBeVisible();
  await expect(fan.getByText(/현재 2명 \/ 501명/)).toBeVisible();
  const recentFans = await api(null, "/api/celebrities/elina/fans?locale=ko");
  assert.equal(recentFans.status, 200);
  assert(recentFans.data.fanCount < 501);
  pass("recent fan list uses the creator-scoped API and keeps leaderboard gated below 501 Passport fans");

  await fan.goto(harness.baseURL + "/community?creator=elina&tab=requests&locale=ko");
  await expect(fan.getByRole("link", { name: /일정 제안/ })).toHaveAttribute("href", "/c/elina/schedule-suggestions?locale=ko");
  await expect(fan.getByRole("link", { name: "팬페이지 개설 신청" })).toHaveAttribute("href", "/bias/requests?locale=ko");
  await expect(fan.getByRole("link", { name: "내 신청 내역" })).toHaveAttribute("href", "/my/requests?locale=ko");
  await fan.goto(harness.baseURL + "/community?creator=elina&tab=certifications&locale=ko");
  await expect(fan.getByRole("heading", { name: "팬 인증", exact: true })).toBeVisible();
  await expect(fan.getByText("현재 참여할 수 있는 인증이 없어요.")).toBeVisible();
  pass("request destinations and the creator-scoped certification tab render through existing components");

  await fan.goto(harness.baseURL + hub);
  await fan.getByLabel("최애 선택").selectOption("yuna");
  await expect(fan).toHaveURL(/\/community\?creator=yuna&tab=posts&locale=ko$/);
  pass("creator switch preserves the community tab and locale");

  for (const [locale, heading, name] of [["en", "Community", "community-en-1440.png"], ["ja", "コミュニティ", "community-ja-1440.png"]]) {
    await guest.setViewportSize({ width: 1440, height: 900 });
    await guest.goto(`${harness.baseURL}/community?creator=elina&tab=posts&locale=${locale}`);
    await expect(guest.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await assertNoOverflow(guest, 1440);
    await screenshot(guest, name);
  }
  pass("English and Japanese community localizations render without overflow");

  const scoped = evidence.requests.filter(request => /\/(?:posts|fans|leaderboard|certifications)(?:\?|$)/.test(request));
  assert(scoped.some(request => request.includes("/api/celebrities/elina/posts")));
  assert(scoped.some(request => request.includes("/api/celebrities/elina/fans")));
  assert(scoped.some(request => request.includes("/api/celebrities/elina/leaderboard")));
  assert(scoped.some(request => request.includes("/api/celebrities/elina/certifications")));
  assert(scoped.every(request => /\/api\/celebrities\/(?:elina|yuna)\//.test(request)));
  assert.deepEqual(errors, []);
  pass("community resource requests remain creator-scoped and browser runtime reports no uncaught errors");
} finally {
  await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
