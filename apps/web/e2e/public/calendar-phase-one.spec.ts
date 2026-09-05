import { expect, test } from "@playwright/test";

// Read-only local QA: no login, reservation, or application mutation.
for (const width of [360, 390, 768, 1024, 1440]) {
  test(`calendar visual contract at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/live/calendar?month=2026-09&locale=ko&celebrity=katseye");
    await expect(page.getByRole("heading", { name: "LIVE 캘린더", exact: true })).toBeVisible();
    await expect(page.locator('[data-calendar-header="standard"]')).toContainText("KST");
    await expect(page.getByRole("link", { name: /다음 달:/ })).toHaveAttribute("href", /celebrity=katseye/);
    const filter = page.getByRole("button", { name: "KATSEYE", exact: true });
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(filter.locator("svg")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("full-calendar.png") });

    await page.goto("/c/katseye?locale=ko");
    const widget = page.getByRole("region", { name: "KATSEYE LIVE 일정" });
    await expect(widget).toBeVisible();
    await expect(page.getByRole("region", { name: "KATSEYE LIVE 일정" })).toHaveCount(1);
    const hero = await page.getByRole("region", { name: "KATSEYE", exact: true }).boundingBox();
    const calendarBox = await widget.boundingBox();
    const nextLive = await page.getByRole("heading", { name: "다가오는 LIVE", exact: true }).boundingBox();
    const passport = await page.getByRole("heading", { name: "내 패스포트", exact: true }).boundingBox();
    expect(calendarBox!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height);
    if (width >= 1024) {
      expect(calendarBox!.x).toBeGreaterThan(nextLive!.x + 100);
      expect(passport!.y).toBeGreaterThan(calendarBox!.y + calendarBox!.height);
    } else {
      expect(calendarBox!.y).toBeGreaterThan(nextLive!.y);
      const benefits = await page.getByRole("heading", { name: "팬 혜택", exact: true }).boundingBox();
      expect(calendarBox!.y + calendarBox!.height).toBeLessThan(benefits!.y);
    }
    await expect(widget).toHaveAttribute("aria-busy", "false");
    await expect(widget.locator('[data-calendar-header="compact"]')).toContainText("KST");
    await expect(widget.getByText("예약 상태 미확인", { exact: true })).toBeVisible();
    const dates = widget.locator('a[data-reservation]');
    if (await dates.count()) {
      const rect = await dates.first().boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await widget.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await widget.screenshot({ path: testInfo.outputPath("mini-calendar.png") });
  });
}
