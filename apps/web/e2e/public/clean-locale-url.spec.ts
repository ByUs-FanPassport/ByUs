import { expect, test } from "@playwright/test";

for (const [browserLocale, locale, title] of [
  ["ko-KR", "ko", "개인정보처리방침"],
  ["en-US", "en", "Privacy Policy"],
  ["ja-JP", "ja", "プライバシーポリシー"],
]) {
  test(`clean URLs retain ${browserLocale} browser language detection`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ locale: browserLocale });
    try {
      const page = await context.newPage();
      const response = await page.goto(`${baseURL}/privacy`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(`${baseURL}/privacy`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    } finally {
      await context.close();
    }
  });
}

test("legacy URLs stay clean through language switches, history, reload and login", async ({ page, baseURL }) => {
  await page.goto("/privacy?locale=ko&attendanceCode=KEEP&returnTo=%2Flive%2Felina%23code#fans");
  await expect(page).toHaveURL(`${baseURL}/privacy?attendanceCode=KEEP&returnTo=%2Flive%2Felina%23code#fans`);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.getByRole("combobox", { name: "언어 선택, 현재 한국어" }).selectOption("en");
  await expect(page).toHaveURL(`${baseURL}/privacy`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
  await page.goBack();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("개인정보처리방침");
  await page.goForward();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page).toHaveURL(`${baseURL}/privacy`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/login?returnTo=%2Flive%2Felina%3FattendanceCode%3DKEEP%23code");
  await expect(page).toHaveURL(`${baseURL}/login?returnTo=%2Flive%2Felina%3FattendanceCode%3DKEEP%23code`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Keep a record of moments with your favorites.");
});

test("repeated links to the current page do not restore the locale query", async ({ page, baseURL }) => {
  await page.goto("/privacy?locale=ko");
  await expect(page).toHaveURL(`${baseURL}/privacy`);
  for (let i = 0; i < 2; i++) {
    const length = await page.evaluate(() => history.length);
    await page.getByRole("link", { name: "개인정보처리방침 열기" }).click();
    await expect.poll(() => page.evaluate(() => history.length)).toBe(length + 1);
    await expect(page).toHaveURL(`${baseURL}/privacy`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  }
});
