import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startHarness } from "./server.mjs";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test-results/cs-local");
await mkdir(out, { recursive: true });
const harness = await startHarness();
const { baseURL, vite, query, actors } = harness;
let browser;
const evidence = { authentication: "Synthetic Privy verifier; real fan/admin guards and local PostgreSQL identity/audit/RPC adapters", checks: [], screenshots: [] };
const check = (name) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function api(actor, pathname, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${baseURL}${pathname}`, { method, headers: { ...(actor ? { Authorization: `Bearer cs-local-${actor}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
async function screenshot(page, name) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots.push(file);
}
try {
  const startup = await api("fan", "/api/me/inquiries");
  assert.equal(startup.status, 200, JSON.stringify(startup.data));
  browser = await chromium.launch({ headless: true });
  const contexts = {};
  for (const name of ["fan", "admin", "other", "viewer", "guest"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((identity) => localStorage.setItem("cs-test-identity", identity), name);
    contexts[name] = context;
  }
  const fan = await contexts.fan.newPage();
  const errors = [];
  fan.on("pageerror", (error) => errors.push(error.message));
  await fan.goto(`${baseURL}/my/inquiries?locale=ko`);
  await expect(fan.getByRole("heading", { name: "문의 내역", exact: true })).toBeVisible();
  await expect(fan.getByText("아직 남긴 문의가 없어요.")).toBeVisible();
  await fan.getByRole("button", { name: "새 문의", exact: true }).click();
  await fan.getByLabel("제목", { exact: true }).fill("LIVE 예약 내역을 확인하고 싶어요");
  await fan.getByLabel("문의 내용", { exact: true }).fill("LIVE를 예약했는데 MY에서 일정을 찾지 못했어요. 예약 내역을 확인해 주세요.");
  await screenshot(fan, "fan-new-desktop.png");
  await fan.getByRole("button", { name: "문의 보내기", exact: true }).click();
  await fan.waitForURL(/\/my\/inquiries\/[a-f0-9-]+\?locale=ko/);
  const id = new URL(fan.url()).pathname.split("/").at(-1);
  await expect(fan.getByText("접수", { exact: true })).toBeVisible();
  check("fan creates inquiry and first message atomically via UI, real routes and SQL");
  const initial = await api("fan", `/api/me/inquiries/${id}`);
  assert.equal(initial.status, 200); assert.equal(initial.data.messages.length, 1);
  assert.equal(initial.headers.get("cache-control"), "private, no-store");

  assert.equal((await api(null, `/api/me/inquiries/${id}`)).status, 401);
  assert.equal((await api("other", `/api/me/inquiries/${id}`)).status, 404);
  assert.equal((await api("other", `/api/me/inquiries/${id}/messages`, { body: "unauthorized", idempotencyKey: crypto.randomUUID() })).status, 404);
  assert.equal((await api("other", "/api/me/inquiries")).data.inquiries.length, 0);
  for (const [pathname, body] of [["/api/admin/inquiries", null], [`/api/admin/inquiries/${id}`, null], [`/api/admin/inquiries/${id}/messages`, { body: "bad", idempotencyKey: crypto.randomUUID() }], [`/api/admin/inquiries/${id}/resolve`, { expectedVersion: 1 }]]) {
    assert.equal((await api("other", pathname, body)).status, 403);
  }
  check("anonymous and cross-owner access denied; non-admin list/read/reply/resolve denied");

  const admin = await contexts.admin.newPage();
  await admin.goto(`${baseURL}/admin/inquiries?lang=ko`);
  await admin.getByRole("link", { name: /LIVE 예약 내역을 확인하고 싶어요/ }).click();
  await expect(admin.getByText(initial.data.messages[0].body)).toBeVisible();
  await admin.getByLabel("메시지", { exact: true }).fill("예약이 정상적으로 접수되어 있어요. MY의 예약한 LIVE에서 다시 확인해 주세요.");
  await admin.getByRole("button", { name: "메시지 보내기", exact: true }).click();
  await expect(admin.getByText("메시지를 보냈어요.")).toBeVisible();
  await fan.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(fan.getByText("답변 완료", { exact: true })).toBeVisible();
  await expect(fan.getByText("예약이 정상적으로 접수되어 있어요. MY의 예약한 LIVE에서 다시 확인해 주세요.")).toBeVisible();
  await screenshot(admin, "admin-conversation-desktop.png");
  await screenshot(fan, "fan-conversation-desktop.png");
  check("operator replies; fan reads persisted reply and answered status");

  const viewer = await contexts.viewer.newPage();
  await viewer.goto(`${baseURL}/admin/inquiries/${id}?lang=en`);
  await expect(viewer.getByText(/You have read-only access/)).toBeVisible();
  await expect(viewer.getByRole("textbox")).toHaveCount(0);
  assert.equal((await api("viewer", `/api/admin/inquiries/${id}/messages`, { body: "bad", idempotencyKey: crypto.randomUUID() })).status, 403);
  assert.equal((await api("viewer", `/api/admin/inquiries/${id}/resolve`, { expectedVersion: 2 })).status, 403);
  check("viewer can read KO/EN conversation but cannot reply or resolve in UI or API");

  let dropped = false;
  await fan.route(`**/api/me/inquiries/${id}/messages`, async (route) => {
    if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await fan.getByLabel("메시지", { exact: true }).fill("확인했어요. 참여 방법도 알려주세요.");
  await fan.getByRole("button", { name: "메시지 보내기", exact: true }).click();
  await expect(fan.getByText(/전송을 확인하지 못했어요/)).toBeVisible();
  await expect(fan.getByLabel("메시지", { exact: true })).toHaveValue("확인했어요. 참여 방법도 알려주세요.");
  await fan.getByRole("button", { name: "메시지 보내기", exact: true }).click();
  await expect(fan.getByText("메시지를 보냈어요.")).toBeVisible();
  await fan.unroute(`**/api/me/inquiries/${id}/messages`);
  const afterRetry = await api("fan", `/api/me/inquiries/${id}`);
  assert.equal(afterRetry.data.messages.filter((message) => message.body === "확인했어요. 참여 방법도 알려주세요.").length, 1);
  assert.equal(afterRetry.data.inquiry.status, "open");
  check("lost successful response retry preserves draft and commits exactly one follow-up");

  await admin.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(admin.getByText("확인했어요. 참여 방법도 알려주세요.")).toBeVisible();
  await admin.getByRole("button", { name: "처리 완료하기", exact: true }).click();
  await expect(admin.getByText("문의를 처리 완료했어요.")).toBeVisible();
  await fan.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(fan.getByText("처리 완료", { exact: true })).toBeVisible();
  await fan.reload();
  await expect(fan.getByText("처리 완료", { exact: true })).toBeVisible();
  check("operator resolves; status and full conversation persist across browser reload");

  for (const [page, name] of [[fan, "fan"], [admin, "admin"]]) {
    await page.setViewportSize({ width: 360, height: 800 });
    await screenshot(page, `${name}-conversation-mobile.png`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    await writeFile(path.join(out, `${name}-axe.json`), JSON.stringify(axe.violations, null, 2));
    assert.deepEqual(axe.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map((node) => node.target) })), []);
  }
  check("360px fan/admin render has no horizontal overflow and no axe WCAG A/AA violations");
  await fan.setViewportSize({ width: 320, height: 800 });
  assert.equal(await fan.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await fan.getByLabel("메시지", { exact: true }).focus();
  await fan.keyboard.type("추가 문의를 키보드로 작성합니다.");
  await fan.keyboard.press("Tab");
  await expect(fan.getByRole("button", { name: "메시지 보내기", exact: true })).toBeFocused();
  assert.equal(await fan.getByRole("button", { name: "메시지 보내기", exact: true }).evaluate((button) => getComputedStyle(button).outlineStyle), "solid");
  await fan.keyboard.press("Enter");
  await expect(fan.getByText("접수", { exact: true })).toBeVisible();
  check("320px reflow and keyboard send reopen a resolved inquiry with visible focus");

  const guest = await contexts.guest.newPage();
  await guest.goto(`${baseURL}/my/inquiries?locale=en`);
  await expect(guest.getByRole("heading", { name: "Sign in to contact us." })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", /returnTo=/);
  const other = await contexts.other.newPage();
  await other.goto(`${baseURL}/my/inquiries/${id}?locale=en`);
  await expect(other.getByText("Inquiry not found.")).toBeVisible();
  check("guest login return path and cross-owner browser denial rendered in English");

  // Separate concurrent PostgreSQL connections, not merely sequential fixture calls.
  const createKey = crypto.randomUUID();
  const pair = await Promise.all([1, 2].map(() => api("other", "/api/me/inquiries", { subject: "Concurrent creation", body: "Same initial message", locale: "en", idempotencyKey: createKey })));
  assert.deepEqual(pair.map((item) => item.status).sort(), [200, 201]);
  assert.equal(pair[0].data.id, pair[1].data.id);
  const concurrentId = pair[0].data.id;
  const replyKey = crypto.randomUUID();
  const posts = await Promise.all([1, 2].map(() => api("other", `/api/me/inquiries/${concurrentId}/messages`, { body: "Concurrent follow-up", idempotencyKey: replyKey })));
  assert.deepEqual(posts.map((item) => item.status), [200, 200]);
  assert.equal(posts[0].data.id, posts[1].data.id);
  const beforeRace = await api("other", `/api/me/inquiries/${concurrentId}`);
  assert.equal(beforeRace.data.messages.length, 2);
  const race = await Promise.all([
    api("admin", `/api/admin/inquiries/${concurrentId}/resolve`, { expectedVersion: beforeRace.data.inquiry.version }),
    api("other", `/api/me/inquiries/${concurrentId}/messages`, { body: "Message racing with completion", idempotencyKey: crypto.randomUUID() }),
  ]);
  assert.ok([200, 409].includes(race[0].status)); assert.equal(race[1].status, 200);
  const afterRace = await api("other", `/api/me/inquiries/${concurrentId}`);
  assert.equal(afterRace.data.inquiry.status, "open"); assert.equal(afterRace.data.messages.length, 3);
  assert.equal((await api("admin", `/api/admin/inquiries/${concurrentId}/resolve`, { expectedVersion: beforeRace.data.inquiry.version })).status, 409);
  check("simultaneous same-key create/post commits once; message/resolve race retains open inquiry and stale-version conflict");
  const dbCount = await query(`select count(*) from public.cs_messages where inquiry_id='${concurrentId}';`, false);
  assert.equal(dbCount, 3);
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`CS local integration PASS: ${evidence.checks.length} checks. Evidence: ${out}`);
  if (process.env.BYUS_CS_REVIEW === "1") {
    console.log(`Review server retained at ${baseURL}; stop this process after visual review.`);
    await new Promise((resolve) => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  }
} catch (error) {
  await writeFile(path.join(out, "failure.txt"), String(error.stack ?? error));
  throw error;
} finally {
  await browser?.close();
  await vite.close();
}
