import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

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
    const firstPartyErrors: string[] = [];
    const thirdPartyErrors: string[] = [];

    page.on("pageerror", (error) => {
      const detail = `pageerror: ${error.stack || error.message}`;
      if (detail.includes("auth.privy.io")) thirdPartyErrors.push(detail);
      else firstPartyErrors.push(detail);
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const detail = `console.error: ${message.text()}`;
      if (detail.includes("auth.privy.io")) thirdPartyErrors.push(detail);
      else firstPartyErrors.push(detail);
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    const response = await page.goto(surface.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible();

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
    expect(firstPartyErrors).toEqual([]);

    const runId = process.env.BYUS_E2E_RUN_ID;
    expect(runId).toBeTruthy();
    const evidenceDirectory = path.join(
      repoRoot,
      "artifacts/e2e/g6-release",
      runId!,
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
        thirdPartyErrors,
      }, null, 2)}\n`,
    );
  });
}
