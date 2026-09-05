import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`short MY and login overlay keep footer at bottom at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1400 });
    await page.goto("/my?locale=ko");
    const footer = page.locator("[data-fan-site-footer]");
    await expect(footer).toHaveCount(1);
    await expect(footer).toBeVisible();
    const clearance = width < 1024 ? 64 : 0;
    await expect.poll(async () => {
      const rect = (await footer.boundingBox())!;
      return Math.abs(rect.y + rect.height + clearance - 1400);
    }).toBeLessThan(2);
    await page.getByRole("link", { name: /Google/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const rect = (await footer.boundingBox())!;
    expect(Math.abs(rect.y + rect.height + clearance - 1400)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath("login-overlay-footer.png"), fullPage: true });
  });

  test(`long creator page footer follows content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/celebrities?locale=ko");
    await expect(page.getByRole("heading", { name: "최애 찾기", exact: true })).toBeVisible();
    const footer = page.locator("[data-fan-site-footer]");
    await expect(footer).toHaveCount(1);
    await expect(footer).toBeVisible();
    const content = (await page.locator("main").boundingBox())!;
    const rect = (await footer.boundingBox())!;
    expect(rect.y).toBeGreaterThanOrEqual(content.y + content.height - 1);
    await footer.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
