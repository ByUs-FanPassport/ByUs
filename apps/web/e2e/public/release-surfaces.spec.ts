import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { observeBrowserErrors, requireEvidenceRunId } from "./public-test-support";

const repoRoot = path.resolve(__dirname, "../../../..");

const surfaces = [
  { screen: "FAN-002", name: "celebrity-directory", path: "/celebrities" },
  { screen: "FAN-003", name: "celebrity-fan-page", path: "/c/kara" },
  { screen: "FAN-004", name: "fan-login", path: "/login" },
  { screen: "FAN-017", name: "benefit-catalog", path: "/benefits?locale=ko&celebrity=kara" },
  { screen: "ADM-001", name: "admin-login", path: "/admin/login" },
] as const;

for (const surface of surfaces) {
  test(`${surface.screen} ${surface.name} is responsive and accessible`, async ({ page }, testInfo) => {
    const browserErrors = observeBrowserErrors(page);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const response = await page.goto(surface.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('main[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("main")).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(testInfo.project.name.endsWith("-360") ? 360 : 1440);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    ).toBe(false);

    const focusTraversalKey = testInfo.project.name.startsWith("webkit-") ? "Alt+Tab" : "Tab";
    await page.keyboard.press(focusTraversalKey);
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);

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
      "public-surfaces",
      surface.screen,
      testInfo.project.name,
    );
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDirectory, `${surface.screen}-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await writeFile(
      path.join(evidenceDirectory, "evidence.json"),
      `${JSON.stringify({
        screen: surface.screen,
        route: surface.path,
        url: page.url(),
        project: testInfo.project.name,
        viewport,
        reducedMotion: true,
        axeViolations: 0,
        horizontalOverflow: false,
        keyboardFocusEnteredDocument: true,
        generatedAt: new Date().toISOString(),
        externalErrors: errorResult.externalErrors,
        externalFailures: errorResult.externalFailures,
      }, null, 2)}\n`,
    );
  });
}
