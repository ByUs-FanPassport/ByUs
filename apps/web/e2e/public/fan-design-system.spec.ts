import { expect, test } from "@playwright/test";

// Read-only visual contract: never reserve, log in, issue a Passport or submit data.
for (const route of ["/", "/live", "/live/calendar", "/my"]) {
  test(`shared fan heading contract ${route}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${route}?locale=ko`);
    const heading = page.locator("h1[data-fan-heading]");
    await expect(heading).toBeVisible();
    const variant = await heading.getAttribute("data-fan-heading");
    const width = page.viewportSize()!.width;
    const breakpoint = variant === "personal-page" ? 640 : 768;
    await expect(heading).toHaveCSS("font-size", width >= breakpoint ? "24px" : "20px");
    await expect(heading).toHaveCSS("font-weight", variant === "editorial" ? "800" : "850");
    if (route === "/") {
      await expect(page.locator('[data-fan-section-header="editorial"]')).toHaveCount(3);
      await expect(page.locator('[data-fan-section-header="editorial"]').first()).toHaveCSS("margin-bottom", "20px");
    }
    if (route === "/my") {
      await expect(page.getByRole("link", { name: /Google/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Google/ })).toHaveCSS("min-height", "52px");
    }
    // Wait for hydration and visible artwork before capturing, not a loading skeleton.
    if (route === "/live") await expect(page.locator('main [role="status"]')).toHaveCount(0);
    if (route === "/") await expect(page.getByRole("link", { name: "Google로 계속하기" }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Only the active slide is visible; clipped, lazy carousel images may have viewport bounds.
    if (route === "/") await expect.poll(() => page.locator('[aria-roledescription="slide"][data-active="true"] img').evaluateAll((images) => images.every((node) => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    }))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("viewport.png"), fullPage: false });
  });
}
