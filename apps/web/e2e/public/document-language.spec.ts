import { expect, test } from "@playwright/test";

test("document language follows direct load, client navigation, reload, and history", async ({ page }) => {
  const response = await page.goto("/?locale=ko&owned=1#fans", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/\?owned=1#fans$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page).toHaveTitle("ByUs | 최애의 LIVE와 팬 패스포트");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest?locale=ko");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "ko_KR");

  await page.getByRole("combobox", { name: "언어 선택, 현재 한국어" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page).not.toHaveURL(/[?&]locale=/);
  await expect(page).toHaveURL(/\/\?owned=1#fans$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("ByUs | LIVE moments and your Fan Passport");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest?locale=en");
  await expect(page.locator('meta[property="og:locale"][content="en_US"]')).toHaveCount(1);

  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/\?owned=1#fans$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page).toHaveTitle("ByUs | 최애의 LIVE와 팬 패스포트");

  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/\?owned=1#fans$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("ByUs | LIVE moments and your Fan Passport");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("ByUs | LIVE moments and your Fan Passport");
});

test("primary page titles use the selected app language", async ({ page }) => {
  for (const [path, title] of [
    ["/", "ByUs | LIVEの瞬間とFan Passport"],
    ["/community", "コミュニティ | ByUs"],
    ["/celebrities", "著名人とクリエイター | ByUs"],
    ["/live", "LIVEイベントと予定 | ByUs"],
  ] as const) {
    const response = await page.goto(`${path}?locale=ja`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/[?&]locale=/);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page).toHaveTitle(title);
  }
});

test("unknown celebrity is an HTML 404 while a published celebrity remains available", async ({ request }) => {
  const unknown = await request.get("/c/not-published?locale=en");
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["content-type"]).toContain("text/html");

  const published = await request.get("/c/katseye?locale=en");
  expect(published.status()).toBe(200);
  expect(published.headers()["content-type"]).toContain("text/html");
  expect(await published.text()).toMatch(/<html[^>]+lang="en"/);

  const localeLess = await request.get("/c/katseye", {
    headers: { cookie: "byus_locale=en", "accept-language": "ko-KR" },
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
