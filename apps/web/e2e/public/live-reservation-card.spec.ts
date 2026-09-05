import { expect, test } from "@playwright/test";

// Read-only: no authentication, reservation, or fan-verification action is submitted.
const slug = process.env.LIVE_CARD_SLUG;
for (const width of [320, 375, 414, 768, 1440]) {
  test(`reservation card preserves dates and action hierarchy at ${width}px`, async ({ page }, testInfo) => {
    test.skip(!slug, "Set LIVE_CARD_SLUG to a published reservable LIVE in the target environment");
    await page.setViewportSize({ width, height: 1600 });
    await page.goto(`/live/${slug}?locale=ko`);
    const card = page.getByRole("complementary", { name: "LIVE 예약 정보" });
    await expect(card).toBeVisible();
    await expect(card.getByText("예약 마감", { exact: true })).toBeVisible();
    const details = card.locator("details");
    await expect(details).not.toHaveAttribute("open");
    const primary = card.locator('[data-fan-action-emphasis="primary"]');
    await expect(primary).toHaveCount(1);
    await expect(primary).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const bounds = await card.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await primary.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const slot = card.locator('[data-live-primary-action-slot]');
    expect(Math.abs((await primary.boundingBox())!.width - (await slot.boundingBox())!.width)).toBeLessThan(1);
    const mission = card.getByRole("link", { name: "LIVE 미션 보기" });
    await expect(mission).toHaveAttribute("href", `/live/${slug}/missions?locale=ko`);
    const arrow = await mission.locator("svg").boundingBox();
    const label = await mission.locator("span span span").boundingBox();
    expect(arrow!.width).toBe(18);
    expect(Math.abs(arrow!.y + arrow!.height / 2 - label!.y - label!.height / 2)).toBeLessThan(1);
    await card.screenshot({ path: testInfo.outputPath("card.png") });
    await details.getByText("예약 전체 기간", { exact: true }).click();
    await expect(details).toHaveAttribute("open");
    await expect(details.locator("time")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.screenshot({ path: testInfo.outputPath("card-expanded.png") });
  });
}
