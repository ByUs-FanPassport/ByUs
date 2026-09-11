import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";

import { startHarness } from "./server.mjs";

const out = path.resolve("test-results/mission-local");
await mkdir(out, { recursive: true });
const harness = await startHarness({ port: Number(process.env.BYUS_MISSION_LOCAL_PORT ?? 4186) });
const evidence = {
  boundary: "Production LiveMissionScreen and CSS with a synthetic testowner Privy alias. Only loopback live detail, mission list, and mission submit endpoints are mocked from the archived Elina KO/EN DTO; external traffic is limited to the archived public artwork image GETs.",
  fixture: harness.fixture,
  checks: [],
  layout: [],
  screenshots: [],
};
const check = (name) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
const errors = [];
let browser;

function watchNetwork(page, label) {
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (target.origin !== harness.baseURL && target.hostname !== "gmrykvmtmuaeswpajteq.supabase.co") {
      errors.push(`${label}: unexpected network request ${request.url()}`);
    }
  });
}

async function pageFor(viewport, locale, scenario) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watchNetwork(page, `${locale}/${scenario}`);
  await page.goto(`${harness.baseURL}/?locale=${locale}&scenario=${scenario}`);
  if (scenario === "already-completed") {
    await expect(page.getByRole("heading", { name: locale === "ko" ? "두 미션 모두 완료!" : "Both missions complete!" })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: locale === "ko" ? "미션 진행" : "Mission progress" })).toBeVisible();
  }
  return { context, page };
}

async function snap(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0), undefined, { timeout: 30000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const file = path.join(out, name);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  evidence.screenshots.push(file);
}

async function assertContained(page, child, parent, label) {
  await expect(child).toBeVisible();
  const [childBox, parentBox] = await Promise.all([child.boundingBox(), parent.boundingBox()]);
  const viewport = page.viewportSize();
  assert(childBox && parentBox && viewport, `${label}: missing layout box`);
  const tolerance = 1;
  assert(childBox.x >= parentBox.x - tolerance, `${label}: exceeds parent left edge`);
  assert(childBox.x + childBox.width <= parentBox.x + parentBox.width + tolerance, `${label}: exceeds parent right edge`);
  assert(childBox.x >= -tolerance, `${label}: exceeds viewport left edge`);
  assert(childBox.x + childBox.width <= viewport.width + tolerance, `${label}: exceeds viewport right edge`);
  evidence.layout.push({ label, child: childBox, parent: parentBox, viewport });
}

async function assertOptionLayout(page, names, label) {
  const fieldset = page.locator("fieldset");
  for (const name of names) {
    const radio = page.getByRole("radio", { name });
    await assertContained(page, page.locator("label").filter({ has: radio }), fieldset, `${label}: ${name}`);
  }
}

async function choose(page, name) {
  const radio = page.getByRole("radio", { name });
  await page.locator("label").filter({ has: radio }).click();
  await expect(radio).toBeChecked();
}

try {
  browser = await chromium.launch({ headless: true });

  const desktop = await pageFor({ width: 1440, height: 1000 }, "ko", "fresh");
  await expect(desktop.page.getByRole("heading", { name: "마음이 가는 작품을 PICK!" })).toBeVisible();
  await expect(desktop.page.getByRole("button", { name: "취향 고르기" })).toHaveAttribute("aria-current", "step");
  await expect(desktop.page.getByRole("button", { name: "디테일 퀴즈" })).toBeVisible();
  await assertOptionLayout(desktop.page, ["풍선을 든 소녀", "플라잉 코퍼", "러브 랫"], "1440 vote card");
  await assertContained(desktop.page, desktop.page.getByRole("button", { name: "이 작품으로 결정" }), desktop.page.getByRole("complementary", { name: "선택 확인" }), "1440 vote action");
  await snap(desktop.page, "fresh-ko-desktop-1440.png");
  const axe = await new AxeBuilder({ page: desktop.page }).analyze();
  assert.deepEqual(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")), []);
  check("archived Korean vote and quiz render at 1440px with no serious or critical axe violations");

  const desktopPick = desktop.page.getByRole("radio", { name: "풍선을 든 소녀" });
  await desktopPick.focus();
  await desktopPick.press("Space");
  await expect(desktopPick).toBeChecked();
  await desktop.page.getByRole("button", { name: "이 작품으로 결정" }).click();
  await expect(desktop.page.getByRole("heading", { name: "빨간 풍선의 모양은?" })).toBeVisible();
  await expect(desktop.page.getByRole("button", { name: /취향 고르기.*완료/ })).toBeDisabled();
  await assertOptionLayout(desktop.page, ["하트", "별", "동그라미", "꽃"], "1440 quiz option");
  await choose(desktop.page, "하트");
  await desktop.page.getByRole("button", { name: "정답 확인하기" }).click();
  await expect(desktop.page.getByRole("heading", { name: "두 미션 모두 완료!" })).toBeVisible();
  await expect(desktop.page.getByRole("status")).toHaveText(/정답이에요/);
  const koRewards = desktop.page.getByRole("region", { name: "이번 미션 보상" });
  await expect(koRewards).toContainText("팬 점수");
  await expect(koRewards).toContainText("응모권");
  await expect(koRewards.getByText("+1")).toHaveCount(2);
  await assertContained(desktop.page, desktop.page.getByRole("link", { name: /엘리나 팬페이지로/ }), desktop.page.locator("main"), "1440 completion primary action");
  await snap(desktop.page, "fresh-ko-complete-desktop-1440.png");
  check("fresh testowner completes vote then correct quiz through loopback submits");
  await desktop.context.close();

  const wrong = await pageFor({ width: 390, height: 900 }, "ko", "wrong-quiz");
  await choose(wrong.page, "풍선을 든 소녀");
  await assertOptionLayout(wrong.page, ["풍선을 든 소녀", "플라잉 코퍼", "러브 랫"], "390 selected vote card");
  await assertContained(wrong.page, wrong.page.getByRole("button", { name: "이 작품으로 결정" }), wrong.page.getByRole("complementary", { name: "선택 확인" }), "390 selected vote action");
  await snap(wrong.page, "selected-vote-ko-mobile-390.png");
  await wrong.page.getByRole("button", { name: "이 작품으로 결정" }).click();
  await expect(wrong.page.getByRole("heading", { name: "빨간 풍선의 모양은?" })).toBeVisible();
  await choose(wrong.page, "별");
  await assertOptionLayout(wrong.page, ["하트", "별", "동그라미", "꽃"], "390 selected quiz option");
  await assertContained(wrong.page, wrong.page.getByRole("button", { name: "정답 확인하기" }), wrong.page.getByRole("complementary", { name: "선택 확인" }), "390 selected quiz action");
  await snap(wrong.page, "selected-quiz-ko-mobile-390.png");
  await wrong.page.getByRole("button", { name: "정답 확인하기" }).click();
  await expect(wrong.page.getByRole("heading", { name: "두 미션 모두 완료!" })).toBeVisible();
  await expect(wrong.page.getByRole("status")).toHaveText("정답은 아니지만, 미션 참여는 완료됐어요.");
  const wrongRewards = wrong.page.getByRole("region", { name: "이번 미션 보상" });
  await expect(wrongRewards.getByText("+1")).toHaveCount(2);
  await assertContained(wrong.page, wrong.page.getByRole("link", { name: /엘리나 팬페이지로/ }), wrong.page.locator("main"), "390 completion primary action");
  await snap(wrong.page, "wrong-quiz-ko-mobile-390.png");
  assert.equal(harness.submissionLog.find((entry) => entry.scenario === "wrong-quiz" && entry.missionId === "2d83ca88-1768-4ab7-85af-2a6e595e5490")?.answers[0].selectedOptionIds[0], "42000000-0000-4000-8000-000000000012");
  check("wrong quiz answer is accepted as completed and receives the archived configured 1 score and 1 ticket response");
  assert(await wrong.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await wrong.context.close();

  const completed = await pageFor({ width: 360, height: 800 }, "ko", "already-completed");
  await expect(completed.page.getByRole("heading", { name: "두 미션 모두 완료!" })).toBeVisible();
  await expect(completed.page.getByRole("status")).toHaveText(/이미 참여한 미션/);
  await expect(completed.page.getByRole("region", { name: "이번 미션 보상" })).toHaveCount(0);
  await expect(completed.page.getByText(/^\+\d+$/)).toHaveCount(0);
  await assertContained(completed.page, completed.page.getByRole("link", { name: /엘리나 팬페이지로/ }), completed.page.locator("main"), "360 existing completion primary action");
  await snap(completed.page, "already-completed-ko-narrow-360.png");
  assert(await completed.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("already-completed list state stays disabled at 360px without inventing a fresh reward result");
  await completed.context.close();

  const retry = await pageFor({ width: 1440, height: 1000 }, "ko", "retry");
  await choose(retry.page, "풍선을 든 소녀");
  await retry.page.getByRole("button", { name: "이 작품으로 결정" }).click();
  await expect(retry.page.getByRole("alert")).toContainText(/다시 시도/);
  await retry.page.getByRole("button", { name: "이 작품으로 결정" }).click();
  await expect(retry.page.getByRole("heading", { name: "빨간 풍선의 모양은?" })).toBeVisible();
  const retryRequests = harness.submissionLog.filter((entry) => entry.scenario === "retry" && entry.missionId === "4067a4ba-5874-4e2a-b100-d030f60ebaac");
  assert.equal(retryRequests.length, 2);
  assert.equal(retryRequests[0].idempotencyKey, retryRequests[1].idempotencyKey);
  check("failed submit retry reuses the exact idempotency key");
  await retry.context.close();

  const english = await pageFor({ width: 390, height: 900 }, "en", "fresh");
  await expect(english.page.getByRole("heading", { name: "Pick the artwork you love" })).toBeVisible();
  await expect(english.page.getByRole("button", { name: "Your pick" })).toHaveAttribute("aria-current", "step");
  await expect(english.page.getByRole("button", { name: "Detail quiz" })).toBeVisible();
  await expect(english.page.getByRole("radio", { name: "Girl with Balloon" })).toBeVisible();
  await snap(english.page, "fresh-en-mobile-390.png");
  await choose(english.page, "Girl with Balloon");
  await english.page.getByRole("button", { name: "Confirm my pick" }).click();
  await expect(english.page.getByRole("heading", { name: "What shape is the red balloon?" })).toBeVisible();
  await choose(english.page, "Heart");
  await english.page.getByRole("button", { name: "Check my answer" }).click();
  await expect(english.page.getByRole("heading", { name: "Both missions complete!" })).toBeVisible();
  await expect(english.page.getByRole("status")).toHaveText(/That's right/);
  assert(await english.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("archived English mission copy renders at 390px without horizontal overflow");
  await english.context.close();

  const entryContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const entry = await entryContext.newPage();
  watchNetwork(entry, "ko/entry");
  await entry.goto(`${harness.baseURL}/entry?locale=ko&scenario=fresh`);
  await expect(entry.getByRole("heading", { name: "엘리나와 뱅크시 한 작품" })).toBeVisible();
  await expect(entry.getByRole("link", { name: "미션 시작하기" })).toHaveAttribute("href", "/live/elina-banksy-instagram-20260918/missions?locale=ko");
  await assertContained(entry, entry.getByRole("link", { name: "미션 시작하기" }), entry.locator("main"), "360 entry CTA in Fan shell");
  await snap(entry, "entry-ko-narrow-360.png");
  check("Elina fan-page mission entry renders inside the real Fan shell at 360px after public detail exposes missions");
  await entryContext.close();

  assert.deepEqual(errors, []);
  check("no browser runtime errors or unexpected network destinations");
} finally {
  evidence.submissions = harness.submissionLog;
  evidence.errors = errors;
  await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
