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
  const hero = page.getByRole("region", { name: "홈 배너", exact: true });
  const managedBanners = hero.locator("[data-managed-home-banner]");
  // Occurrences and banners are independent; the existing guide is the final slide.
  await expect(hero.locator('article[aria-roledescription="slide"]')).toHaveCount(await managedBanners.count() + 1);
  const primaryAction = hero.locator('article[data-active="true"] a').first();
  await expect(primaryAction).toBeVisible();
  await expect(primaryAction).toHaveAttribute("href", /^(\/(?!\/)|https:\/\/)/);
  await expect(hero.locator('article[aria-hidden="true"]:not([inert])')).toHaveCount(0);

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

  const googleActions = page.getByRole("link", { name: "Google로 계속하기" });
  const passportActions = page.getByRole("link", {
    name: /Fan Passport 발급받기/,
  });
  const secondaryAction =
    viewport?.width === 360 ? googleActions.first() : googleActions.last();
  const secondaryActionBox = await secondaryAction.boundingBox();
  expect(secondaryActionBox).not.toBeNull();
  expect(secondaryActionBox!.height).toBe(viewport?.width === 360 ? 48 : 44);
  if (viewport?.width === 360) {
    await expect(passportActions).toBeHidden();
    const favorites = page.locator("#celebrities");
    const guide = page.locator("[data-home-guide-carousel]").first();
    expect((await favorites.boundingBox())!.y).toBeLessThan((await guide.boundingBox())!.y);
  } else {
    const passportBox = await passportActions.boundingBox();
    expect(passportBox).not.toBeNull();
    expect(passportBox!.height).toBe(44);
    expect(secondaryActionBox!.width).toBe(passportBox!.width);
    expect(secondaryActionBox!.width).toBe(280);
  }

  const primaryActionBox = await primaryAction.boundingBox();
  expect(primaryActionBox).not.toBeNull();
  expect(primaryActionBox!.height).toBe(48);
  expect(primaryActionBox!.height).toBeGreaterThanOrEqual(secondaryActionBox!.height);
  expect(primaryActionBox!.x).toBeGreaterThanOrEqual(0);
  expect(primaryActionBox!.x + primaryActionBox!.width).toBeLessThanOrEqual(viewport!.width);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  const focusTraversalKey = testInfo.project.name.startsWith("webkit-") ? "Alt+Tab" : "Tab";
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const skipLink = page.getByRole("link", { name: "본문으로 바로가기" });
  for (let step = 0; step < 3 && !(await skipLink.evaluate((element) => element === document.activeElement)); step += 1) {
    await page.keyboard.press(focusTraversalKey);
  }
  await expect(skipLink).toBeFocused();

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
