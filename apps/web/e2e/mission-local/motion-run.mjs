import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, expect } from "@playwright/test";

import { startHarness } from "./server.mjs";

const out = path.resolve("test-results/mission-local/motion");
await mkdir(out, { recursive: true });
const harness = await startHarness({ port: Number(process.env.BYUS_MISSION_LOCAL_PORT ?? 4187) });
const mobileFramesOnly = process.env.BYUS_MISSION_MOBILE_FRAMES_ONLY === "1";
const evidencePath = path.join(out, "motion-evidence.json");
const evidence = mobileFramesOnly
  ? JSON.parse(await readFile(evidencePath, "utf8"))
  : { checks: [], frames: [], videos: [], animationSamples: {}, errors: [] };
if (mobileFramesOnly) {
  evidence.errors = [];
  evidence.frames = evidence.frames.filter((file) => !/completion-(?:mid|settled|reduced-motion)-mobile-390\.png$/.test(file));
}
const check = (name) => { if (!evidence.checks.includes(name)) evidence.checks.push(name); console.log(`PASS ${name}`); };
let browser;

function watch(page, label) {
  page.on("pageerror", (error) => evidence.errors.push(`${label}: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== harness.baseURL && url.hostname !== "gmrykvmtmuaeswpajteq.supabase.co") {
      evidence.errors.push(`${label}: unexpected network request ${url}`);
    }
  });
}

async function settleAssets(page) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0), undefined, { timeout: 30000 });
}

async function frame(page, name) {
  await settleAssets(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const file = path.join(out, name);
  await page.screenshot({ path: file, fullPage: true, animations: "allow" });
  evidence.frames.push(file);
}

async function choose(page, name) {
  const radio = page.getByRole("radio", { name });
  await page.locator("label").filter({ has: radio }).click();
  await expect(radio).toBeChecked();
}

async function openMission(context, locale, scenario = "fresh") {
  const page = await context.newPage();
  watch(page, `${locale}/${scenario}`);
  await page.goto(`${harness.baseURL}/?locale=${locale}&scenario=${scenario}`);
  await expect(page.getByRole("navigation", { name: locale === "ko" ? "미션 진행" : "Mission progress" })).toBeVisible();
  await settleAssets(page);
  return page;
}

async function animations(page) {
  return page.evaluate(() => document.getAnimations({ subtree: true }).map((animation) => {
    const computed = animation.effect?.getComputedTiming();
    const timing = animation.effect?.getTiming();
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    return {
      name: animation instanceof CSSAnimation ? animation.animationName : "web-animation",
      playState: animation.playState,
      currentTime: animation.currentTime,
      endTime: computed?.endTime,
      iterations: timing?.iterations,
      target: target instanceof HTMLElement ? `${target.tagName}.${target.className}` : null,
    };
  }));
}

async function completeJourney(page, locale, rapid = false) {
  const ko = locale === "ko";
  if (rapid) {
    for (const name of ko ? ["풍선을 든 소녀", "플라잉 코퍼", "러브 랫"] : ["Girl with Balloon", "Flying Copper", "Love Rat"]) {
      await choose(page, name);
    }
    const finalName = ko ? "러브 랫" : "Love Rat";
    const finalRadio = page.getByRole("radio", { name: finalName });
    await expect(finalRadio).toBeChecked();
    const expectedId = await finalRadio.getAttribute("value");
    const activeId = await page.locator("img[data-active='true']").getAttribute("src");
    const optionImage = await page.locator("label").filter({ has: finalRadio }).locator("img").getAttribute("src");
    assert(expectedId && activeId === optionImage, "rapid selection preview does not match final checked radio");
    evidence.animationSamples.rapidSelection = { finalName, expectedId, activeId };
  } else {
    await choose(page, ko ? "풍선을 든 소녀" : "Girl with Balloon");
  }
  await page.getByRole("button", { name: ko ? "이 작품으로 결정" : "Confirm my pick" }).click();
  await expect(page.getByRole("heading", { name: ko ? "빨간 풍선의 모양은?" : "What shape is the red balloon?" })).toBeVisible();
  await choose(page, ko ? "하트" : "Heart");
  await page.getByRole("button", { name: ko ? "정답 확인하기" : "Check my answer" }).click();
  await page.locator("main[data-celebrate='true']").waitFor({ state: "attached" });
}

try {
  browser = await chromium.launch({ headless: true });

  if (!mobileFramesOnly) {
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: out, size: { width: 1440, height: 1000 } },
  });
  const desktop = await openMission(desktopContext, "ko");
  const video = desktop.video();
  await completeJourney(desktop, "ko", true);
  await desktop.waitForTimeout(640);
  evidence.animationSamples.desktopMid = await animations(desktop);
  const midNames = evidence.animationSamples.desktopMid.map((item) => item.name);
  for (const expected of ["printArrive", "paperBurst", "stageReveal", "numberReveal", "sealArrive", "stampImpact"]) {
    assert(midNames.some((name) => name.includes(expected)), `missing active ${expected} animation`);
  }
  evidence.animationSamples.stampApproach = await desktop.locator("[class*='completionSeal']").evaluate(element => getComputedStyle(element).transform);
  await frame(desktop, "completion-mid-desktop-1440.png");
  await desktop.waitForFunction(() => document.getAnimations().every(animation => animation.playState === "finished"), undefined, { timeout: 5000 });
  evidence.animationSamples.desktopSettled = await animations(desktop);
  const celebrations = evidence.animationSamples.desktopSettled.filter((item) => /printArrive|paperBurst|stageReveal|numberReveal|sealArrive|stampImpact/.test(item.name));
  assert(celebrations.length >= 5, "completion animation set was not retained for finite-state inspection");
  assert(celebrations.every((item) => item.playState === "finished" && item.iterations === 1 && Number.isFinite(item.endTime)), "celebration did not finish as a finite single iteration");
  evidence.animationSamples.stampLanded = await desktop.locator("[class*='completionSeal']").evaluate(element => getComputedStyle(element).transform);
  assert.notEqual(evidence.animationSamples.stampApproach, evidence.animationSamples.stampLanded, "stamp approach did not move into the landed state");
  await frame(desktop, "completion-settled-desktop-1440.png");
  check("desktop completion exposes artwork print, confetti, reward and reveal animations, then finishes without looping");
  await desktopContext.close();
  const videoPath = await video.path();
  const namedVideo = path.join(out, "completion-motion-desktop-1440.webm");
  const { rename } = await import("node:fs/promises");
  await rename(videoPath, namedVideo);
  evidence.videos.push(namedVideo);
  }

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const mobile = await openMission(mobileContext, "ko");
  await completeJourney(mobile, "ko");
  await mobile.waitForTimeout(640);
  evidence.animationSamples.mobileMid = await animations(mobile);
  await frame(mobile, "completion-mid-mobile-390.png");
  await mobile.waitForFunction(() => document.getAnimations().every(animation => animation.playState === "finished"), undefined, { timeout: 5000 });
  assert((await animations(mobile)).filter((item) => /paperBurst|printArrive|numberReveal/.test(item.name)).every((item) => item.playState === "finished"));
  await frame(mobile, "completion-settled-mobile-390.png");
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("mobile 390 completion motion reaches the same settled layout without overflow");
  await mobileContext.close();

  if (!mobileFramesOnly) {
  const existingContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const existing = await existingContext.newPage();
  watch(existing, "already-completed");
  await existing.goto(`${harness.baseURL}/?locale=ko&scenario=already-completed`);
  const existingMain = existing.locator("main[data-celebrate='false']");
  await expect(existingMain).toBeVisible();
  await expect(existing.locator("main [aria-hidden='true'] i")).toHaveCount(0);
  await expect(existing.getByRole("region", { name: "이번 미션 보상" })).toHaveCount(0);
  assert(!(await animations(existing)).some((item) => /paperBurst|printArrive|numberReveal/.test(item.name)));
  check("already-completed state does not replay celebration, confetti, or fresh rewards");
  await existingContext.close();
  }

  const reducedContext = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  const reduced = await openMission(reducedContext, "ko");
  await completeJourney(reduced, "ko");
  await expect(reduced.locator("main[data-celebrate='true']")).toBeVisible();
  const reducedAudit = await reduced.evaluate(() => ({
    confettiDisplay: getComputedStyle(document.querySelector("main[data-celebrate='true'] div:has(> i)")).display,
    animations: document.getAnimations({ subtree: true }).filter((item) => item.playState === "running").map((item) => ({
      name: item instanceof CSSAnimation ? item.animationName : "web-animation",
      transform: item.effect instanceof KeyframeEffect && item.effect.target instanceof HTMLElement ? getComputedStyle(item.effect.target).transform : null,
    })),
  }));
  evidence.animationSamples.reduced = reducedAudit;
  assert.equal(reducedAudit.confettiDisplay, "none");
  assert.equal(reducedAudit.animations.filter((item) => item.transform && item.transform !== "none").length, 0);
  await frame(reduced, "completion-reduced-motion-mobile-390.png");
  check("prefers-reduced-motion hides confetti and leaves no running transform animation");
  await reducedContext.close();

  if (!mobileFramesOnly) {
  const retryContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const retry = await openMission(retryContext, "ko", "retry");
  await choose(retry, "풍선을 든 소녀");
  await retry.getByRole("button", { name: "이 작품으로 결정" }).click();
  const pending = retry.getByRole("button", { name: "제출 중…" });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("data-pending", "true");
  await expect(retry.getByRole("alert")).toContainText("선택한 답은 그대로예요");
  await expect(retry.getByRole("radio", { name: "풍선을 든 소녀" })).toBeChecked();
  await retry.getByRole("button", { name: "이 작품으로 결정" }).click();
  await expect(retry.getByRole("heading", { name: "빨간 풍선의 모양은?" })).toBeVisible();
  const requests = harness.submissionLog.filter((item) => item.scenario === "retry" && item.missionId === "4067a4ba-5874-4e2a-b100-d030f60ebaac");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  check("pending feedback is visible and failed retry preserves answer plus exact idempotency key");
  await retryContext.close();
  }

  assert.deepEqual(evidence.errors, []);
} finally {
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await browser?.close();
  await harness.vite.close();
}
