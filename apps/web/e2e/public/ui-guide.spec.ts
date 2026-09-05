import { expect, test } from "@playwright/test";

// Read-only public QA. Authenticated MY / Passport visuals use isolated fixtures,
// never a production login or a state-changing API request.
for (const width of [360, 390, 768, 1024, 1440]) {
  test(`creator directory keeps its footprint at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/celebrities?locale=ko");
    await expect(page.getByRole("heading", { name: "최애 찾기", exact: true })).toBeVisible();
    const cards = page.getByRole("article");
    test.skip(await cards.count() === 0, "No published creators in this environment");
    const first = cards.first();
    await expect(first.getByRole("link")).toHaveCount(1);
    const before = (await first.boundingBox())!;
    const name = await first.getByRole("heading").innerText();
    await page.getByRole("searchbox", { name: "이름으로 찾기" }).fill(name);
    await expect(cards).toHaveCount(1);
    expect(Math.abs((await cards.first().boundingBox())!.width - before.width)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("searchbox", { name: "이름으로 찾기" }).fill("");
    await page.screenshot({ path: testInfo.outputPath("creators.png"), fullPage: true });
  });
}
