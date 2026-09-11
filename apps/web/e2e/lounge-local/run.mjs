import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "./server.mjs";

const out = path.resolve("apps/web/test-results/lounge-local");
await mkdir(out, { recursive: true });
const harness = await startHarness();
const { baseURL, query, actors } = harness;
const evidence = { authentication: "Synthetic Privy identities in loopback-only standalone harness; real app fan/admin authorization guards, route validation and PostgreSQL RPC/storage. Other fanpage panels use fixtures.", checks: [], screenshots: [] };
if (process.env.BYUS_LOUNGE_VERIFY_STAGE === "home") { const previous = JSON.parse(await readFile(path.join(out, "evidence.json"), "utf8")); evidence.checks = previous.checks; evidence.screenshots = previous.screenshots; evidence.reused = "Lounge behavior and room rendering from preceding successful checks; only home fixture selector changed."; }
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function api(actor, url, body, method = body ? "POST" : "GET") {
  const response = await fetch(baseURL + url, { method, headers: { ...(actor ? { Authorization: `Bearer lounge-local-${actor}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
const endpoint = "/api/celebrities/elina/lounge?locale=ko";
async function snap(page, name) { await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0,0); }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const file = path.join(out, name); await page.screenshot({ path: file, fullPage: true }); evidence.screenshots.push(file); }
async function send(page, body) { await page.getByRole("textbox", { name: "메시지", exact: true }).fill(body); await page.getByRole("button", { name: "메시지 보내기", exact: true }).click(); }
let browser;
try {
  assert.equal((await api(null, endpoint, { body: "unauthorized", idempotencyKey: crypto.randomUUID() })).status, 401);
  assert.equal((await api("unknown", endpoint)).status, 401);
  check("guest write and invalid-token public read denied by real fan auth guard");
  browser = await chromium.launch({ headless: true });
  const contexts = {}, pages = {}, errors = [];
  for (const name of ["fan", "other", "admin", "guest"]) {
    contexts[name] = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
    await contexts[name].addInitScript(identity => localStorage.setItem("lounge-test-identity", identity), name);
    pages[name] = await contexts[name].newPage();
    pages[name].on("pageerror", error => { errors.push(error.message); console.error("BROWSER_ERROR", error.message); });
  }
  const fan = pages.fan, other = pages.other;
  if (process.env.BYUS_LOUNGE_VERIFY_STAGE !== "home") {
  await Promise.all([fan.goto(baseURL + "/c/elina/lounge"), other.goto(baseURL + "/c/elina/lounge")]);
  await expect(fan.getByRole("heading", { name: "엘리나 라운지" })).toBeVisible();
  await expect(fan.getByText("첫 이야기를 기다리고 있어요")).toBeVisible();
  await send(fan, "오늘 커버 영상 계속 듣는 중이에요 🎧");
  await expect(other.getByText("오늘 커버 영상 계속 듣는 중이에요 🎧", { exact: true })).toBeVisible({ timeout: 15000 });
  check("two independent accounts receive committed message without page reload");
  await other.getByRole("button", { name: "답장", exact: true }).click();
  await send(other, "저도요! 마지막 소절 너무 좋아요");
  await expect(fan.getByText("저도요! 마지막 소절 너무 좋아요", { exact: true })).toBeVisible({ timeout: 15000 });
  const row = fan.locator("article").filter({ hasText: "저도요! 마지막 소절 너무 좋아요" });
  await expect(row.locator("blockquote")).toContainText("오늘 커버 영상");
  await row.getByRole("button", { name: /메시지에 반응/ }).click();
  await row.getByRole("button", { name: "❤️", exact: true }).click();
  await expect(other.getByRole("button", { name: "❤️ 1", exact: true })).toBeVisible({ timeout: 15000 });
  check("reply quote and emoji reaction synchronize across accounts");
  await snap(fan, "lounge-desktop.png");
  const first = (await api("fan", endpoint)).data.messages.find(m => m.body.startsWith("오늘 커버"));
  assert.equal((await api("other", `/api/lounge-messages/${first.id}`, null, "DELETE")).status, 404);
  const parallelKey = crypto.randomUUID();
  const duplicate = await Promise.all(Array.from({ length: 3 }, () => api("fan", endpoint, { body: "같은 요청은 한 번만 저장해요", idempotencyKey: parallelKey })));
  assert(duplicate.every(r => r.status === 200));
  assert.equal(new Set(duplicate.map(r => r.data.id)).size, 1);
  assert.equal((await api("fan", endpoint, { body: "바뀐 내용", idempotencyKey: parallelKey })).status, 409);
  check("foreign deletion rejected; concurrent same-key sends persist once; changed replay conflicts");
  let dropped = false;
  await fan.route("**/api/celebrities/elina/lounge?locale=ko", async route => {
    if (route.request().method() === "POST" && !dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await send(fan, "연결이 끊겨도 한 번만 보내져요");
  await expect(fan.getByRole("alert")).toContainText("연결을 확인");
  await expect(fan.getByRole("textbox", { name: "메시지", exact: true })).toHaveValue("연결이 끊겨도 한 번만 보내져요");
  await fan.getByRole("button", { name: "메시지 보내기", exact: true }).click();
  await expect(fan.getByRole("textbox", { name: "메시지", exact: true })).toHaveValue("");
  assert.equal((await api("fan", endpoint)).data.messages.filter(m => m.body === "연결이 끊겨도 한 번만 보내져요").length, 1);
  await fan.unroute("**/api/celebrities/elina/lounge?locale=ko");
  check("lost successful response preserves draft and retry does not duplicate saved message");
  await contexts.other.setOffline(true);
  await send(fan, "다시 연결되면 이 이야기도 보여요");
  await contexts.other.setOffline(false);
  await expect(other.getByText("다시 연결되면 이 이야기도 보여요", { exact: true })).toBeVisible({ timeout: 15000 });
  check("offline account reconnects and receives persisted backlog automatically");
  await api("admin", `/api/admin/lounge-messages/${first.id}`, { reason: "로컬 검증: 공개 원문 숨김" });
  await expect(fan.locator("blockquote")).toContainText("삭제된 메시지", { timeout: 15000 });
  await expect(fan.getByText("오늘 커버 영상 계속 듣는 중이에요 🎧", { exact: true })).toHaveCount(0);
  check("admin hide removes source and redacts reply quote on already-open fan screen");
  await fan.setViewportSize({ width: 390, height: 900 });
  await snap(fan, "lounge-mobile.png");
  assert(await fan.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile horizontal overflow");
  const sendBox = await fan.getByRole("button", { name: "메시지 보내기" }).boundingBox();
  assert(sendBox && sendBox.y + sendBox.height <= 900, "mobile composer below viewport");
  check("390px mobile lounge keeps composer within viewport and avoids horizontal overflow");
  // Bulk fixture is committed directly only inside this disposable local DB.
  // It exercises a backlog larger than the 50-message API page without rate-limit bypass in product code.
  await contexts.other.setOffline(true);
  await query(`insert into public.fan_lounge_messages(celebrity_id,app_user_id,body,idempotency_key,created_at)
    select 'c7200000-0000-4000-8000-000000000001','${actors.fan.id}','이어진 이야기 '||i,extensions.gen_random_uuid(),clock_timestamp()+make_interval(secs=>i) from generate_series(1,65) i;`, false);
  await contexts.other.setOffline(false);
  await expect(other.getByText("이어진 이야기 65", { exact: true })).toBeVisible({ timeout: 15000 });
  const unread = other.getByRole("button", { name: /^새 메시지/ });
  if (await unread.count()) await unread.click();
  await other.getByRole("button", { name: "이전 대화 보기" }).click();
  await expect(other.getByText("이어진 이야기 1", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(other.getByRole("button", { name: "최신 대화로", exact: true })).toBeVisible();
  const historical = (await api("admin", "/api/admin/lounge-messages")).data;
  const oldId = await query("select to_jsonb(id) from public.fan_lounge_messages where body='이어진 이야기 1';", false);
  await api("admin", `/api/admin/lounge-messages/${oldId}`, { reason: "로컬 검증: 이전 페이지 숨김" });
  await expect(other.getByText("이어진 이야기 1", { exact: true })).toHaveCount(0, { timeout: 15000 });
  check("65-message reconnect backlog remains fully reachable by keyset pagination; old-page moderation refreshes");
  assert(historical.messages.length > 0);
  await other.getByRole("button", { name: "최신 대화로" }).click();
  await expect(other.getByText("이어진 이야기 65", { exact: true })).toBeVisible();
  await other.locator('[role="log"]').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  const latest = (await api("fan", endpoint)).data.messages[0];
  await api("fan", `/api/lounge-messages/${latest.id}`, null, "DELETE");
  await expect(other.getByText("이어진 이야기 65", { exact: true })).toHaveCount(0, { timeout: 15000 });
  await expect(other.getByRole("button", { name: /^새 메시지/ })).toHaveCount(0);
  check("deleting latest message does not miscount existing history as new arrivals");
  await fan.getByRole("textbox", { name: "메시지", exact: true }).fill("이전 계정의 작성 중 메시지");
  await fan.evaluate(() => { localStorage.setItem("lounge-test-identity", "other"); window.dispatchEvent(new Event("lounge-identity")); });
  await expect(fan.getByRole("textbox", { name: "메시지", exact: true })).toHaveValue("");
  await expect(fan.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
  check("account switch clears private composer and ownership without reloading");
  await pages.guest.goto(baseURL + "/c/elina/lounge?locale=en");
  await expect(pages.guest.getByRole("link", { name: "Sign in to join the conversation" })).toBeVisible();
  await expect(pages.guest.getByRole("textbox")).toHaveCount(0);
  await snap(pages.guest, "lounge-english-guest.png");
  await pages.admin.goto(baseURL + "/admin/lounge-messages");
  await expect(pages.admin.getByRole("heading", { name: "팬 라운지", exact: true })).toBeVisible();
  await expect(pages.admin.getByText("이어진 이야기 64", { exact: true })).toBeVisible();
  await snap(pages.admin, "lounge-admin.png");
  check("English guest read-only entry and authenticated admin moderation screen render");
  } else {
    await api("fan", endpoint, { body: "오늘 커버 영상 계속 듣는 중이에요 🎧", idempotencyKey: crypto.randomUUID() });
    await api("other", endpoint, { body: "저도요! 마지막 소절 너무 좋아요", idempotencyKey: crypto.randomUUID() });
  }
  await fan.setViewportSize({ width: 1440, height: 1040 });
  await fan.goto(baseURL + "/c/elina");
  await expect(fan.getByRole("link", { name: "대화에 참여하기", exact: true })).toBeVisible();
  await expect(fan.getByText("좋아요 0명", { exact: true })).toBeVisible();
  await expect(fan.getByRole("heading", { name: /엘리나 팬페이지에 오신 걸 환영해요/ })).toBeVisible();
  await fan.getByRole("textbox", { name: "댓글 남기기", exact: true }).fill("공지에 인사를 남겨요");
  await fan.getByRole("button", { name: "등록", exact: true }).click();
  await expect(fan.getByText("공지에 인사를 남겨요", { exact: true })).toBeVisible({ timeout: 15000 });
  assert(!(await api("fan", endpoint)).data.messages.some(m => m.body === "공지에 인사를 남겨요"));
  await snap(fan, "home-desktop.png");
  await fan.setViewportSize({ width: 390, height: 900 });
  await snap(fan, "home-mobile.png");
  assert(await fan.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("home preview and actual zero count render; existing notice comments still persist separately; PC/mobile inspected");
  assert.deepEqual(errors, []);
  check("no browser runtime errors");
} finally {
  await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
