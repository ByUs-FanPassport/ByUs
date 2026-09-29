import { expect, test } from "@playwright/test";
import { APP_LOCALES } from "../../i18n/locales";

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
      await expect(page.locator('[data-fan-section-header="editorial"]').first()).toHaveCSS("margin-bottom", "16px");
    }
    if (route === "/my") {
      await expect(page.getByRole("link", { name: "로그인하기", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "로그인하기", exact: true })).toHaveCSS("min-height", "52px");
    }
    // Wait for hydration and visible artwork before capturing, not a loading skeleton.
    if (route === "/live") {
      await expect(page.locator('main [role="status"]')).toHaveCount(0);
      const status = page.locator('[data-live-status][data-density="compact"]').first();
      // Catalog may be empty as real schedules change; check geometry whenever present.
      if (await status.count()) await expect(status).toHaveCSS("min-height", "0px");
    }
    if (route === "/") await expect(page.getByRole("link", { name: "로그인하기" }).first()).toBeVisible();
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

// Covers text expansion in every supported language using the real public composition.
for (const locale of APP_LOCALES) {
  test(`localized content composition ${locale}`, async ({ page }) => {
    await page.goto(`/?locale=${locale}`);
    const favorites = page.locator("#celebrities");
    await expect(favorites.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(favorites.locator('[aria-busy="true"]')).toHaveCount(0);
    const header = favorites.locator("[data-fan-section-header]");
    const width = page.viewportSize()!.width;
    if (width <= 390) {
      const copy = await header.locator("h2").boundingBox();
      const row = await header.boundingBox();
      expect(copy!.width).toBeGreaterThanOrEqual(row!.width - 1);
    }
    for (const filter of await favorites.locator("button[aria-pressed]").all()) {
      expect((await filter.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(filter).toHaveCSS("border-radius", "12px");
    }
    for (const action of await favorites.locator("[data-social-icon-only]").all()) {
      const rect = (await action.boundingBox())!;
      expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(`/community?locale=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("h1[data-fan-heading]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
