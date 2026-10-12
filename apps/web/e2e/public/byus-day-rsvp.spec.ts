import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
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

test("keeps old and short invitation links, locale, campaign queries and RSVP anchors", async ({ page, request }) => {
  for (const path of ["/byus-day", "/connect/byus-day", "/kyaa-wave"]) {
    const response = await request.get(`${path}?locale=en&utm_source=poster`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const destination = new URL(response.headers().location, response.url());
    expect(destination.pathname).toBe("/connect/kyaa-wave");
    expect(destination.searchParams.get("locale")).toBe("en");
    expect(destination.searchParams.get("utm_source")).toBe("poster");
  }
  await page.goto("/byus-day?locale=ko&utm_source=shared#rsvp");
  await expect(page).toHaveURL(/\/connect\/kyaa-wave\?(?:locale=ko&)?utm_source=shared#rsvp$/);
  await expect(page.getByRole("heading", { name: "kyaa wave", exact: true })).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page).toHaveTitle("kyaa wave | 참가 신청 마감");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://kyaa.io/connect/kyaa-wave");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /kyaa-wave\/share-20261008\.jpg$/);
  const response = await request.get("/connect/kyaa-wave?locale=ko");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("shows closed registration in both languages without collecting personal details", async ({ page }, testInfo) => {
  for (const locale of ["ko", "en"]) {
    await page.goto(`/connect/kyaa-wave?locale=${locale}`);
    const status = page.getByRole("complementary", { name: locale === "ko" ? "참가 신청 마감" : "RSVPs closed" });
    await expect(status).toContainText(locale === "ko" ? "신규 신청을 받지 않습니다." : "We are no longer accepting registrations.");
    const statusBox = await status.boundingBox();
    const titleBox = await page.getByRole("heading", { name: "kyaa wave", exact: true }).boundingBox();
    expect(statusBox!.y + statusBox!.height).toBeLessThan(titleBox!.y);
    await expect(page.locator("#rsvp h2")).toHaveText(locale === "ko" ? "참가 신청이 마감되었습니다." : "RSVPs are now closed.");
    await expect(page.locator("#rsvp")).toContainText(locale === "ko" ? "행사와 출입 안내를 별도로 전해 드립니다." : "Registered guests will receive event details and base entry instructions separately.");
    await expect(page.locator("form, input, select, button[type=submit]")).toHaveCount(0);
    const parkingTitle = locale === "ko" ? "행사장 내 주차 불가" : "No parking at the venue";
    await expect(page.locator("#rsvp").getByRole("heading", { name: parkingTitle })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${locale}-closed.png`), fullPage: true });
  }
});

test("rejects stale and direct submissions without accepting personal details", async ({ request }) => {
  for (const data of [undefined, {}, { koreanName: "Test", consent: true }]) {
    const response = await request.post("/api/byus-day/rsvp", { data });
    expect(response.status()).toBe(410);
    expect(await response.json()).toEqual({ error: { code: "RSVP_CLOSED" } });
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

test("supports the closure skip link and English fallback with keyboard focus", async ({ page }) => {
  await page.goto("/connect/kyaa-wave?locale=ja");
  const skip = page.getByRole("link", { name: "Skip to registration status" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#rsvp")).toBeFocused();
  await expect(page.locator("#rsvp h2")).toHaveText("RSVPs are now closed.");
});

test("shows the matching language poster and opens the original", async ({ page }, testInfo) => {
  for (const locale of ["ko", "en"]) {
    await page.goto(`/connect/kyaa-wave?locale=${locale}`);
    const posterLink = page.locator(`a[href="/images/connect/kyaa-wave/poster-${locale}-20261008.webp"]`);
    const poster = posterLink.getByRole("img");
    await expect(poster).toBeVisible();
    await expect(poster).toHaveAttribute("alt", locale === "ko" ? "kyaa wave Enter × Tech 한글 행사 포스터" : "kyaa wave Enter × Tech English event poster");
    const invitation = page.getByRole("region", { name: "kyaa wave", exact: true });
    await expect(invitation).toContainText(locale === "ko" ? "2026년 10월 22일 목요일 18:30 시작" : "Thursday, October 22, 2026 · Starts at 18:30");
    await expect(invitation).toContainText(locale === "ko" ? "용산미군기지" : "Yongsan Garrison");
    await expect(page.locator('section[aria-labelledby="schedule-title"]')).toContainText(locale === "ko" ? "같은 호텔 1층 펍" : "pub on the hotel’s first floor");
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
    await expect(page.locator('section[aria-labelledby="schedule-title"] ol li')).toHaveText(locale === "ko" ? ["오프닝", "식사(코스요리)", "세션 및 Q&A", "럭키드로우", "kyaa LIVE"] : ["Opening", "Multi-course dinner", "Sessions & Q&A", "Lucky draw", "kyaa LIVE"]);
    await expect(page.getByText(locale === "ko" ? "네트워킹·래플" : "Networking & raffle", { exact: false })).toBeVisible();
    const arrival = page.getByRole("region", { name: locale === "ko" ? "오시는 길" : "Getting here" });
    await expect(arrival).toBeVisible();
    await expect(arrival.locator("details")).not.toHaveAttribute("open");
    const directionsToggle = arrival.locator("summary");
    await directionsToggle.focus();
    await expect(directionsToggle).toBeFocused();
    expect(await directionsToggle.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(arrival.locator("details")).toHaveAttribute("open", "");
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
    await expect(page.locator("#rsvp details")).toHaveCount(0);
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
    await expect(original).toHaveURL(new RegExp(`/images/connect/kyaa-wave/poster-${locale}-20261008\\.webp$`));
    await expect(original.locator("img")).toBeVisible();
    await original.close();
  }
});
