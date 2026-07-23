import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { observeBrowserErrors, requireEvidenceRunId } from "./public-test-support";

const repoRoot = path.resolve(__dirname, "../../../..");

test("FAN-001 public home is responsive and accessible", async ({ page }, testInfo) => {
  const browserErrors = observeBrowserErrors(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page).toHaveTitle(/ByUs/);
  const primaryAction = page.getByRole("link", { name: /라이브 예약하기|LIVE 상세보기/ });
  await expect(primaryAction).toBeVisible();
  const actionLabel = (await primaryAction.textContent()) ?? "";
  if (actionLabel.includes("라이브 예약하기")) {
    await expect(primaryAction).toHaveAttribute("href", /\/login\?returnTo=%2Flive%2F.+&intent=reserve/);
  } else {
    await expect(primaryAction).toHaveAttribute("href", /^\/live\//);
    const hero = primaryAction.locator("xpath=ancestor::article[1]");
    await expect(hero.locator("p").first()).toContainText(/종료|취소|LIVE/);
  }
  await expect(page.getByRole("link", { name: /Fan Passport 발급받기/ }).first()).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(testInfo.project.name.endsWith("-360") ? 360 : 1440);

  const mobileNavigation = page.getByRole("navigation", { name: "모바일 주요 메뉴" });
  const desktopContext = page.getByRole("complementary", { name: "로그인 전 팬 활동" });
  if (viewport?.width === 360) {
    await expect(mobileNavigation).toBeVisible();
    await expect(desktopContext).toBeHidden();
  } else {
    await expect(mobileNavigation).toBeHidden();
    await expect(desktopContext).toBeVisible();
  }

  const primaryActionBox = await primaryAction.boundingBox();
  expect(primaryActionBox).not.toBeNull();
  expect(primaryActionBox!.x).toBeGreaterThanOrEqual(0);
  expect(primaryActionBox!.x + primaryActionBox!.width).toBeLessThanOrEqual(viewport!.width);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  const focusTraversalKey = testInfo.project.name.startsWith("webkit-") ? "Alt+Tab" : "Tab";
  await page.keyboard.press(focusTraversalKey);
  await expect(page.getByRole("link", { name: "본문으로 바로가기" })).toBeFocused();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  const errorResult = browserErrors.result();
  expect(errorResult.firstPartyErrors).toEqual([]);

  const runId = requireEvidenceRunId();
  const evidenceDirectory = path.join(
    repoRoot,
    "artifacts/e2e/g6-release",
    runId,
    "public-home",
    testInfo.project.name,
  );
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDirectory, `FAN-001-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await writeFile(
    path.join(evidenceDirectory, "evidence.json"),
    `${JSON.stringify({
      screen: "FAN-001",
      url: page.url(),
      project: testInfo.project.name,
      viewport,
      generatedAt: new Date().toISOString(),
      externalErrors: errorResult.externalErrors,
      externalFailures: errorResult.externalFailures,
    }, null, 2)}\n`,
  );

});
