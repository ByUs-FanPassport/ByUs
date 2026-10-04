import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { observeBrowserErrors } from "./public-test-support";

test.setTimeout(60_000);
// Service-worker-owned requests bypass Playwright's mocked RSVP responses in WebKit.
test.use({ serviceWorkers: "block" });
let browserErrors: ReturnType<typeof observeBrowserErrors>;
let mockedFailureStatuses: Set<number>;
test.beforeEach(async ({ page }) => {
  // RSVP does not use wallet listings; keep this third-party lookup deterministic.
  await page.route("https://explorer-api.walletconnect.com/v3/wallets**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ listings: {} }) }));
  mockedFailureStatuses = new Set();
  browserErrors = observeBrowserErrors(page);
});
test.afterEach(async () => {
  if (!browserErrors) return;
  const result = browserErrors.result();
  await test.info().attach("browser-errors", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.firstPartyErrors.filter(error => {
    const status = /^console.error: Failed to load resource: the server responded with a status of (\d{3})\b/.exec(error)?.[1];
    return !status || !mockedFailureStatuses.has(Number(status));
  })).toEqual([]);
});

async function fillRsvp(page: Page) {
  await page.locator('[name="koreanName"]').fill("홍길동");
  await page.locator('[name="englishName"]').fill("Gildong Hong");
  await page.locator('[name="phone"]').fill("010-1234-5678");
  await page.locator('[name="residentRegistrationNumber"]').fill("900101-1234567");
  await page.locator('[name="affiliation"]').fill("샐리랩");
  await page.locator('[name="occupation"]').fill("프로듀서");
  await page.locator('[name="email"]').fill("guest@example.com");
  await page.locator('[name="nationality"]').selectOption("KR");
  await page.locator('[name="consent"]').check();
}

test("shows the complete English poster in both languages and opens the original", async ({ page }, testInfo) => {
  for (const locale of ["ko", "en"]) {
    await page.goto(`/connect/byus-day?locale=${locale}`);
    const posterLink = page.locator('a[href="/images/connect/byus-day/poster-program-en-20261004.webp"]');
    const poster = posterLink.getByRole("img");
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const geometry = await poster.evaluate(image => {
      const rect = image.getBoundingClientRect();
      const container = image.closest("a")!.getBoundingClientRect();
      return { ratio: rect.height / rect.width, top: rect.top, bottom: rect.bottom, containerTop: container.top, containerBottom: container.bottom };
    });
    expect(geometry.ratio).toBeCloseTo(1.5, 2);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.containerTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.containerBottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const security = page.getByRole("region", { name: "SECURITY NOTICE" });
    await expect(security).toBeVisible();
    await expect(security).toContainText("USFKI 5200.08A CH1");
    const officialLink = security.getByRole("link");
    await expect(officialLink).toHaveAttribute("href", "https://home.army.mil/humphreys/about/garrison/DES/physical-security/access-control");
    await expect(officialLink).toHaveAttribute("target", "_blank");
    await officialLink.focus();
    await expect(officialLink).toBeFocused();
    expect(await officialLink.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await expect(page.locator("#schedule-title").locator("..").locator("ol li")).toHaveText(locale === "ko" ? ["오프닝", "식사(코스요리)", "세션 및 Q&A", "럭키드로우", "BYUS LIVE"] : ["Opening", "Multi-course dinner", "Sessions & Q&A", "Lucky draw", "BYUS LIVE"]);
    await expect(page.getByText(locale === "ko" ? "네트워킹·래플" : "Networking & raffle", { exact: false })).toBeVisible();
    const arrival = page.getByRole("region", { name: locale === "ko" ? "오시는 길" : "Getting here" });
    await expect(arrival).toBeVisible();
    await expect(arrival.getByRole("img", { name: locale === "ko" ? "Gate 1에서 호텔까지" : "From Gate 1 to the hotel" })).toBeVisible();
    const enlargedMap = arrival.getByRole("link", { name: locale === "ko" ? "약도 크게 보기" : "Enlarge the map" });
    await expect(enlargedMap).toHaveAttribute("href", `/images/connect/byus-day/gate-1-directions-${locale}-20261004-v2.svg`);
    await expect(enlargedMap).toHaveAttribute("target", "_blank");
    const mapOpened = page.context().waitForEvent("page");
    await enlargedMap.click();
    const mapPage = await mapOpened;
    await mapPage.waitForLoadState("load");
    await expect(mapPage.locator("svg")).toHaveAttribute("viewBox", "0 200 905 520");
    await mapPage.close();
    await expect(arrival).toContainText(locale === "ko" ? "녹사평역 4번 출구" : "Noksapyeong Station, Exit 4");
    await expect(arrival.locator("h3").locator("..").locator("ol li")).toHaveCount(3);
    await expect(arrival).toContainText(locale === "ko" ? "삼각지역 13번 출구" : "Samgakji Station, Exit 13");
    await expect(arrival).toContainText(locale === "ko" ? "도보 약 5분" : "About a 5-minute walk");
    await expect(arrival).toContainText(locale === "ko" ? "행사 출입구·집합 위치" : "event entrance, meeting point");
    const mapLinks = arrival.locator('a[href^="https:"]');
    await expect(mapLinks).toHaveCount(3);
    await expect(mapLinks.nth(0)).toHaveAttribute("href", /^https:\/\/map\.naver\.com\/p\/search\//);
    await expect(mapLinks.nth(1)).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    await expect(mapLinks.nth(2)).toHaveAttribute("href", "https://www.dragonhilllodge.com/your-stay/getting-here");
    for (const link of await mapLinks.all()) await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const privacy = page.locator("details");
    await expect(privacy).toHaveCount(2);
    for (const section of await privacy.all()) await section.locator("summary").click();
    await expect(privacy.nth(0)).toContainText(locale === "ko" ? "국적" : "nationality");
    await expect(privacy.nth(0)).not.toContainText(locale === "ko" ? "주민등록번호" : "resident registration number");
    await expect(privacy.nth(1)).toContainText(locale === "ko" ? "주민등록번호 13자리" : "13-digit Korean resident registration number");
    for (const section of await privacy.all()) {
      await expect(section).toContainText(locale === "ko" ? "용산미군기지 출입 담당부서" : "Yongsan Garrison access control office");
      await expect(section).toContainText(locale === "ko" ? "2026년 10월 23일" : "October 23, 2026");
      await expect(section).not.toContainText(locale === "ko" ? "1개월" : "one month");
    }
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(1);
    await expect(page.locator('[name="consent"]')).toHaveAttribute("required", "");
    await expect(page.locator('[name="consent"]')).not.toBeChecked();
    await page.keyboard.press("Tab");
    await posterLink.focus();
    await expect(posterLink).toBeFocused();
    expect(await posterLink.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${locale}-invitation.png`), fullPage: true });
    const opened = page.context().waitForEvent("page");
    await posterLink.click();
    const original = await opened;
    await original.waitForLoadState("load");
    await expect(original).toHaveURL(/\/images\/connect\/byus-day\/poster-program-en-20261004\.webp$/);
    await expect(original.locator("img")).toBeVisible();
    await original.close();
  }
});

test("validates required fields and announces errors without sending a request", async ({ page }) => {
  let sent = false;
  await page.route("**/api/byus-day/rsvp", route => { sent = true; return route.abort(); });
  await page.goto("/byus-day?locale=ko");
  await expect(page).toHaveURL(/\/connect\/byus-day(?:\?locale=ko)?$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.getByRole("button", { name: "참가 신청하기", exact: true }).click();
  await expect(page.locator('[name="koreanName"]')).toBeFocused();
  await expect(page.locator('[name="koreanName"]')).toHaveAttribute("aria-invalid", "true");
  expect(sent).toBe(false);
  await fillRsvp(page);
  await page.locator('[name="phone"]').fill("123");
  await page.getByRole("button", { name: "참가 신청하기", exact: true }).click();
  await expect(page.locator('[name="phone"]')).toBeFocused();
  await expect(page.getByText("휴대폰 번호를 확인해 주세요.", { exact: true })).toBeVisible();
  expect(sent).toBe(false);
  await page.locator('[name="phone"]').fill("010-1234-5678");
  await page.locator('[name="residentRegistrationNumber"]').fill("123");
  await page.getByRole("button", { name: "참가 신청하기", exact: true }).click();
  await expect(page.locator('[name="residentRegistrationNumber"]')).toBeFocused();
  await expect(page.getByText("주민등록번호 13자리를 확인해 주세요.", { exact: true })).toBeVisible();
  expect(sent).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("retries a failed submission with the same key and shows a focused receipt", async ({ page }, testInfo) => {
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/byus-day/rsvp", route => {
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) mockedFailureStatuses.add(503);
    return route.fulfill({ status: payloads.length === 1 ? 503 : 202, contentType: "application/json", body: JSON.stringify(payloads.length === 1 ? { error: { code: "RSVP_UNAVAILABLE" } } : { status: "accepted" }) });
  });
  await page.goto("/connect/byus-day?locale=ko");
  await fillRsvp(page);
  await page.getByRole("button", { name: "참가 신청하기", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("신청을 접수하지 못했어요");
  await page.getByRole("button", { name: "참가 신청하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "신청이 접수되었어요." })).toBeFocused();
  expect(payloads).toHaveLength(2);
  expect(payloads[0].idempotencyKey).toEqual(payloads[1].idempotencyKey);
  expect(payloads[1]).toMatchObject({ phone: "+821012345678", residentRegistrationNumber:"900101-1234567", nationality: "KR", consent: true, koreanName: "홍길동", englishName: "Gildong Hong" });
  expect(Object.keys(payloads[1]).sort()).toEqual(["affiliation", "consent", "email", "englishName", "idempotencyKey", "koreanName", "locale", "nationality", "occupation", "phone", "residentRegistrationNumber"].sort());
  await expect(page.locator("form")).toHaveCount(0);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain("guest@example.com");
  expect(storage).not.toContain("홍길동");
  expect(storage).not.toContain("900101");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach("native-rsvp-receipt", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("supports English, mobile keyboard focus, long names, and closed submissions", async ({ page }, testInfo) => {
  await page.route("**/api/byus-day/rsvp", route => {
    mockedFailureStatuses.add(410);
    return route.fulfill({ status:410, contentType:"application/json", body:JSON.stringify({ error:{ code:"RSVP_CLOSED" } }) });
  });
  await page.goto("/connect/byus-day?locale=ja");
  await expect(page.locator('[lang="en"]').getByRole("heading", { name:"RSVP", exact:true })).toBeVisible();
  await fillRsvp(page);
  await page.locator('[name="englishName"]').fill("Alexandra Charlotte von Testington de la Cruz");
  await page.locator('[name="phone"]').fill("+1 213 373 4253");
  const consent = page.locator('[name="consent"]');
  await page.locator('[name="nationality"]').focus();
  await page.keyboard.press("Tab");
  await expect(consent).toBeFocused();
  expect(await consent.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await page.getByRole("button", { name:"Send my RSVP" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("RSVPs are now closed.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach("native-rsvp-closed-english", { body: await page.screenshot({ fullPage:true }), contentType:"image/png" });
});
