import { expect, test } from "@playwright/test";

test("document language follows direct load, client navigation, reload, and history", async ({ page }) => {
  const response = await page.goto("/?locale=ko", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "ko_KR");

  await page.getByRole("link", { name: "언어 선택, 현재 한국어" }).click();
  await expect(page).toHaveURL(/locale=en/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_US");

  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/locale=ko/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");

  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/locale=en/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

});

test("unknown celebrity is an HTML 404 while a published celebrity remains available", async ({ request }) => {
  const unknown = await request.get("/c/not-published?locale=en");
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["content-type"]).toContain("text/html");

  const published = await request.get("/c/kara?locale=en");
  expect(published.status()).toBe(200);
  expect(published.headers()["content-type"]).toContain("text/html");
  expect(await published.text()).toMatch(/<html[^>]+lang="en"/);

  const localeLess = await request.get("/c/kara", {
    headers: { cookie: "byus_locale=en" },
  });
  expect(localeLess.status()).toBe(200);
  const localeLessHtml = await localeLess.text();
  expect(localeLessHtml).toMatch(/<html[^>]+lang="ko"/);
  expect(localeLessHtml).toContain('property="og:locale" content="ko_KR"');

  const adminEnglish = await request.get("/admin?lang=en&locale=ko");
  expect(adminEnglish.status()).toBe(200);
  const adminEnglishHtml = await adminEnglish.text();
  expect(adminEnglishHtml).toMatch(/<html[^>]+lang="en"/);
  expect(adminEnglishHtml).toContain('property="og:locale" content="en_US"');
});
