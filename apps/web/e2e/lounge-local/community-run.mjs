import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "./server.mjs";

const out = path.resolve("apps/web/test-results/fan-community-local");
await mkdir(out, { recursive: true });
const harness = await startHarness({ communityMode: true });
const { baseURL } = harness;
const evidence = {
  authentication: "Synthetic Privy identities in a loopback-only harness with real fan/admin guards, handlers, PostgreSQL RPCs, and storage.",
  checks: [],
  screenshots: [],
};
const check = (name) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function api(actor, url, body, method = body ? "POST" : "GET") {
  const response = await fetch(baseURL + url, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer lounge-local-${actor}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
async function snap(page, name) {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const file = path.join(out, name);
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots.push(file);
}
async function snapVisibleSections(page, prefix) {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const heroFile = path.join(out, `${prefix}-hero.png`);
  const cheersFile = path.join(out, `${prefix}-cheers.png`);
  await page.screenshot({ path: heroFile });
  const cheers = page.locator("#cheers");
  await cheers.evaluate((element) => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 16));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await cheers.screenshot({ path: cheersFile });
  evidence.screenshots.push(heroFile, cheersFile);
}

let browser;
try {
  const fans = await api(null, "/api/celebrities/elina/fans?locale=ko");
  assert.equal(fans.status, 200);
  assert.equal(fans.data.likeCount, 2);
  assert.equal(fans.data.fanCount, 3); assert.equal(fans.data.publicFanCount, 3);
  assert.deepEqual(fans.data.fans.map(fan => fan.nickname).sort(), ["달빛길", "별빛팬", "바다소리"].sort());
  const seeded = await api(null, "/api/celebrities/elina/cheers?locale=ko&limit=5");
  assert.equal(seeded.data.total, 1);
  assert.deepEqual(seeded.data.comments.map((comment) => comment.body), ["먼저 남겨둔 응원"]);
  assert.equal((await api("unknown", "/api/celebrities/elina/fans?locale=ko")).status, 401);
  assert.equal((await api(null, "/api/celebrities/elina/cheers?locale=ko", { body: "guest", idempotencyKey: crypto.randomUUID() })).status, 401);
  assert.equal((await api(null, "/api/celebrities/elina/lounge?locale=ko")).status, 404);
  assert.equal((await api("fan", "/api/lounge-messages/c7500000-0000-4000-8000-000000000001/reactions", { emoji: "❤️", enabled: true }, "PUT")).status, 404);
  check("real fan projection keeps count at two, exposes only opted-in active thumbnail, excludes legacy reply, rejects guest/invalid auth, and closes old lounge APIs");

  browser = await chromium.launch({ headless: true });
  const contexts = {};
  const pages = {};
  const errors = [];
  for (const [name, viewport] of [["fan", { width: 1440, height: 1050 }], ["other", { width: 1440, height: 1050 }], ["guest", { width: 1440, height: 1050 }]]) {
    contexts[name] = await browser.newContext({ viewport });
    await contexts[name].addInitScript((identity) => localStorage.setItem("lounge-test-identity", identity), name);
    pages[name] = await contexts[name].newPage();
    pages[name].on("pageerror", (error) => { errors.push(error.message); console.error("BROWSER_ERROR", error.message); });
  }

  const fan = pages.fan;
  const other = pages.other;
  await Promise.all([fan.goto(baseURL + "/c/elina?locale=ko"), other.goto(baseURL + "/c/elina?locale=ko")]);
  await expect(fan.getByRole("link", { name: "함께하는 팬 3명 보기", exact: true })).toBeVisible();
  await expect(fan.locator("[data-fan-community] img").first()).toBeVisible();
  await expect(fan.getByRole("heading", { name: "응원댓글" })).toBeVisible();
  await expect(fan.getByText("먼저 남겨둔 응원", { exact: true })).toBeVisible();
  await expect(fan.getByText("공개되면 안 되는 이전 답글", { exact: true })).toHaveCount(0);
  await snapVisibleSections(fan, "community-ko-1440");
  await snap(fan, "community-ko-1440.png");
  await fan.setViewportSize({ width: 390, height: 900 });
  await snapVisibleSections(fan, "community-ko-390");
  await snap(fan, "community-ko-390.png");
  assert(await fan.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "KO mobile horizontal overflow");
  await fan.setViewportSize({ width: 1440, height: 1050 });
  check("KO desktop and 390px community render actual count, opted-in thumbnail, and top-level cheers without horizontal overflow");

  await pages.guest.goto(baseURL + "/c/elina?locale=en");
  await expect(pages.guest.getByRole("button", { name: "View 3 fans", exact: true })).toBeVisible();
  await expect(pages.guest.getByRole("link", { name: "Sign in to leave a cheer" })).toBeVisible();
  await expect(pages.guest.getByRole("textbox", { name: "Leave a cheer" })).toHaveCount(0);
  await snapVisibleSections(pages.guest, "community-en-1440");
  await snap(pages.guest, "community-en-1440.png");
  await pages.guest.setViewportSize({ width: 390, height: 900 });
  await snapVisibleSections(pages.guest, "community-en-390");
  await snap(pages.guest, "community-en-390.png");
  assert(await pages.guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "EN mobile horizontal overflow");
  check("EN guest gate renders read-only at desktop and 390px without horizontal overflow");

  let dropped = false;
  await fan.route("**/api/celebrities/elina/cheers?locale=ko", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const fanBody = "응답이 끊겨도 한 번만 남는 응원";
  await fan.getByRole("textbox", { name: "응원 남기기" }).fill(fanBody);
  await fan.getByRole("button", { name: "응원 보내기" }).click();
  await expect(fan.getByRole("alert")).toContainText("연결을 확인");
  await fan.getByRole("button", { name: "응원 보내기" }).click();
  await expect(fan.getByRole("textbox", { name: "응원 남기기" })).toHaveValue("");
  await fan.unroute("**/api/celebrities/elina/cheers?locale=ko");
  const fanRows = (await api("fan", "/api/celebrities/elina/cheers?locale=ko&limit=20")).data.comments.filter((comment) => comment.body === fanBody);
  assert.equal(fanRows.length, 1);
  check("lost successful response retries with the same idempotency key and persists one cheer");

  const otherBody = "다른 계정이 남긴 응원";
  await other.getByRole("textbox", { name: "응원 남기기" }).fill(otherBody);
  await other.getByRole("button", { name: "응원 보내기" }).click();
  await expect(other.getByText(otherBody, { exact: true })).toBeVisible({ timeout: 10000 });
  assert.equal((await api("other", `/api/cheers/${fanRows[0].id}`, null, "DELETE")).status, 404);
  const ownedRow = fan.locator("li").filter({ hasText: fanBody });
  await expect(ownedRow.getByRole("button", { name: "내 응원댓글 삭제" })).toBeVisible({ timeout: 10000 });
  await ownedRow.getByRole("button", { name: "내 응원댓글 삭제" }).click();
  await expect(fan.getByText(fanBody, { exact: true })).toHaveCount(0, { timeout: 10000 });
  const otherRow = (await api("other", "/api/celebrities/elina/cheers?locale=ko&limit=20")).data.comments.find((comment) => comment.body === otherBody);
  assert(otherRow);
  assert.equal((await api("admin", `/api/admin/lounge-messages/${otherRow.id}`, { reason: "로컬 검증: 응원댓글 숨김" })).status, 200);
  await other.reload();
  await expect(other.getByText(otherBody, { exact: true })).toHaveCount(0);
  check("two accounts post; foreign deletion is denied, owner deletion succeeds, and existing admin moderation hides the shared row");

  assert.equal((await api("fan", "/api/me/fan-activity-visibility", { enabled: false }, "PATCH")).status, 410);
  const optedOut = await api("fan", "/api/celebrities/elina/fans?locale=ko");
  assert.equal(optedOut.data.likeCount, 2);
  assert.equal(optedOut.data.fanCount, 3); assert.equal(optedOut.data.publicFanCount, 3);
  assert.equal(optedOut.data.fans.length, 3);
  await fan.reload();
  await expect(fan.getByRole("link", { name: "함께하는 팬 3명 보기", exact: true })).toBeVisible();
  await expect(fan.locator("[data-fan-community] img")).toHaveCount(3);
  check("retired visibility API rejects writes while all three actual fans remain visible");

  assert.deepEqual(errors, []);
  check("no browser runtime errors");
} finally {
  await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
