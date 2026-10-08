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
  await expect(page).toHaveURL(/\/connect\/kyaa-wave\?locale=ko&utm_source=shared#rsvp$/);
  await expect(page.getByRole("heading", { name: "kyaa wave", exact: true })).toBeAttached();
  await expect(page).toHaveTitle("kyaa wave | 참가 신청");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://byus.kr/connect/kyaa-wave");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /kyaa-wave\/share-20261008\.jpg$/);
  const response = await request.get("/connect/kyaa-wave?locale=ko");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

async function fillRsvp(page: Page) {
  await page.locator('[name="koreanName"]').fill("홍길동");
  await page.locator('[name="englishName"]').fill("Gildong Hong");
  await page.locator('[name="phone"]').fill("010-1234-5678");
  await page.locator('#rsvp-residentRegistrationNumber').fill("900101");
  await page.locator('#rsvp-registration-part-1').fill("1");
  await page.locator('#rsvp-registration-part-2').fill("234567");
  await page.locator('[name="affiliation"]').fill("샐리랩");
  await page.locator('[name="occupation"]').fill("프로듀서");
  await page.locator('[name="email"]').fill("guest@example.com");
  await page.locator('[name="consent"]').check();
}

test("shows the deadline above the invitation and defaults nationality to Korea", async ({ page }, testInfo) => {
  for (const locale of ["ko", "en"]) {
    await page.goto(`/connect/kyaa-wave?locale=${locale}`);
    const deadline = page.getByRole("complementary", { name: locale === "ko" ? "인적사항 제출 마감" : "Personal details deadline" });
    await expect(deadline).toContainText(locale === "ko" ? "10월 12일(월) 자정까지 · 한국시간" : "By the end of October 12 (Mon), KST");
    await expect(deadline.locator("time")).toHaveAttribute("datetime", "2026-10-13T00:00:00+09:00");
    const deadlineBox = await deadline.boundingBox();
    const titleBox = await page.getByRole("heading", { name: "kyaa wave", exact: true }).boundingBox();
    expect(deadlineBox!.y + deadlineBox!.height).toBeLessThan(titleBox!.y);
    await page.screenshot({ path: testInfo.outputPath(`${locale}-deadline-top.png`) });
    const nationality = page.locator('[name="nationality"]');
    await expect(nationality).toHaveValue("KR");
    await nationality.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${locale}-default-nationality.png`) });
    await nationality.selectOption("JP");
    await expect(nationality).toHaveValue("JP");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
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
    const security = page.getByRole("region", { name: "SECURITY NOTICE" });
    await expect(security).toBeVisible();
    await expect(security.locator("strong")).toHaveText([locale === "ko" ? "규정" : "Policy"]);
    if (locale === "ko") await expect(security).toContainText("주한미군 기지 출입통제 지침");
    await expect(security).toContainText("USFKI 5200.08A CH1");
    const officialLink = security.getByRole("link");
    await expect(officialLink).toHaveText(locale === "ko" ? "출입절차 규정 · 새 탭에서 보기" : "Installation Access Policy · Opens in a new tab");
    await expect(officialLink).toHaveAttribute("href", "https://home.army.mil/humphreys/about/garrison/DES/physical-security/access-control");
    await expect(officialLink).toHaveAttribute("target", "_blank");
    await officialLink.focus();
    await expect(officialLink).toBeFocused();
    expect(await officialLink.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
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
    const privacyTitles = locale === "ko" ? ["일반 개인정보 수집·이용 안내", "[필수] 주민등록번호 처리 안내"] : ["Personal information collection and use", "[Required] Resident registration number processing"];
    for (const [index, title] of privacyTitles.entries()) {
      const trigger = page.getByRole("button", { name: title, exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      // Contrast must be measured after the shared overlay fade has settled.
      await dialog.evaluate(async element => {
        await Promise.all(element.parentElement!.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
      await expect(dialog).toContainText(locale === "ko" ? "개인정보 처리자: (주)셀리랩" : "Personal information controller: Sallylab Co., Ltd.");
      await expect(dialog).toContainText(locale === "ko" ? "용산미군기지 출입 담당부서" : "Yongsan Garrison access control office");
      await expect(dialog.locator("ul li")).toHaveCount(4);
      if (index === 0) {
        await expect(dialog).toContainText(locale === "ko" ? "2026년 10월 23일" : "October 23, 2026");
        await expect(dialog).toContainText(locale === "ko" ? "국적" : "nationality");
        await expect(dialog).toContainText(locale === "ko" ? "직책" : "job title");
        await expect(dialog).not.toContainText(locale === "ko" ? "주민등록번호" : "resident registration number");
      } else {
        await expect(dialog).toContainText(locale === "ko" ? "처리항목: 주민등록번호" : "Information processed: Korean resident registration number");
        await expect(dialog).toContainText(locale === "ko" ? "미군기지 출입자 확인 및 출입명단 제출" : "verifying base visitors and submitting the base entry list");
        await expect(dialog).toContainText(locale === "ko" ? "출입 절차 완료 후 지체 없이 파기합니다." : "deleted without delay after the access procedure is complete");
        await expect(dialog).not.toContainText(locale === "ko" ? "2026년 10월 23일" : "October 23, 2026");
      }
      const close = dialog.getByRole("button", { name: locale === "ko" ? "닫기" : "Close", exact: true });
      await expect(close).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await dialog.screenshot({ path: testInfo.outputPath(`${locale}-privacy-${index}.png`) });
      if (index === 0) await page.keyboard.press("Escape");
      else await close.click();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    await expect(page.getByRole("textbox", { name: locale === "ko" ? "직책" : "Job title", exact: true })).toBeVisible();
    await expect(page.locator('#rsvp label span[aria-hidden="true"]')).toHaveCount(9);
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
    await expect(original).toHaveURL(new RegExp(`/images/connect/kyaa-wave/poster-${locale}-20261008\\.webp$`));
    await expect(original.locator("img")).toBeVisible();
    await original.close();
  }
});

test("validates required fields and announces errors without sending a request", async ({ page }) => {
  let sent = false;
  await page.route("**/api/byus-day/rsvp", route => { sent = true; return route.abort(); });
  await page.goto("/byus-day?locale=ko");
  await expect(page).toHaveURL(/\/connect\/kyaa-wave(?:\?locale=ko)?$/);
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
  await page.locator('#rsvp-residentRegistrationNumber').fill("123");
  await page.getByRole("button", { name: "참가 신청하기", exact: true }).click();
  await expect(page.locator('#rsvp-residentRegistrationNumber')).toBeFocused();
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
  await page.goto("/connect/kyaa-wave?locale=ko");
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
  await page.goto("/connect/kyaa-wave?locale=ja");
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

test("masks only the last six digits and preserves typing, editing, paste and reveal", async ({ page }) => {
  for (const locale of ["ko", "en"]) {
    await page.goto(`/connect/kyaa-wave?locale=${locale}`);
    const birth = page.locator("#rsvp-residentRegistrationNumber");
    const first = page.locator("#rsvp-registration-part-1");
    const last = page.locator("#rsvp-registration-part-2");
    const complete = page.locator('[name="residentRegistrationNumber"]');
    await birth.focus();
    await page.keyboard.type("9001011234567");
    await expect(birth).toHaveValue("900101");
    await expect(first).toHaveValue("1");
    await expect(last).toHaveValue("234567");
    await expect(complete).toHaveValue("900101-1234567");
    await expect(birth).toHaveAttribute("type", "text");
    await expect(first).toHaveAttribute("type", "text");
    await expect(last).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: locale === "ko" ? "주민등록번호 전체 보기" : "Show full registration number", exact: true }).click();
    await expect(last).toHaveAttribute("type", "text");
    const hide = page.getByRole("button", { name: locale === "ko" ? "주민등록번호 뒷자리 가리기" : "Hide last 6 digits of registration number", exact: true });
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await hide.click();
    await expect(last).toHaveAttribute("type", "password");
    await expect(complete).toHaveValue("900101-1234567");
    await birth.fill("901231");
    await last.fill("456789");
    await expect(complete).toHaveValue("901231-1456789");
    await birth.evaluate(element => {
      const data = new DataTransfer();
      data.setData("text/plain", "930202-3456789");
      // Firefox drops constructor-supplied data for untrusted ClipboardEvents.
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: data });
      element.dispatchEvent(paste);
    });
    await expect(complete).toHaveValue("930202-3456789");
    await first.evaluate(element => {
      const data = new DataTransfer();
      data.setData("text/plain", "2345678");
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: data });
      element.dispatchEvent(paste);
    });
    await expect(complete).toHaveValue("930202-2345678");
    await last.focus();
    await last.evaluate(element => (element as HTMLInputElement).setSelectionRange(0, 0));
    await page.keyboard.press("Backspace");
    await expect(first).toBeFocused();
    for (const control of [birth, first, last, page.getByRole("button", { name: locale === "ko" ? "주민등록번호 전체 보기" : "Show full registration number", exact: true })]) {
      const rect = await control.boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});


test("balances event sections and preserves directions disclosure and deep links", async ({ page }, testInfo) => {
  for (const locale of ["ko", "en"]) {
    await page.goto(`/connect/kyaa-wave?locale=${locale}`);
    const arrival = page.getByRole("region", { name: locale === "ko" ? "오시는 길" : "Getting here" });
    const disclosure = arrival.locator("details");
    const toggle = arrival.locator("summary");
    await expect(disclosure).not.toHaveAttribute("open");
    await expect(arrival.getByRole("img")).not.toBeVisible();
    const invitation = await page.getByRole("region", { name: "kyaa wave", exact: true }).boundingBox();
    const form = await page.locator("#rsvp").boundingBox();
    const schedule = await page.locator('section[aria-labelledby="schedule-title"]').boundingBox();
    const arrivalBox = await arrival.boundingBox();
    if (page.viewportSize()!.width > 900) {
      expect(Math.abs(invitation!.y - form!.y)).toBeLessThan(1);
      expect(Math.abs(invitation!.height - form!.height)).toBeLessThan(400);
      expect(schedule!.y).toBeGreaterThan(form!.y + form!.height);
      expect(arrivalBox!.width).toBeGreaterThan(form!.width * 2);
    }
    await page.screenshot({ path: testInfo.outputPath(`${locale}-balanced-collapsed.png`), fullPage: true });
    await page.locator('nav a[href="#arrival-title"]').click();
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(arrival.getByRole("img")).toBeVisible();
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(disclosure).not.toHaveAttribute("open");
    await page.locator('nav a[href="#arrival-title"]').click();
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(arrival.getByRole("img")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await arrival.screenshot({ path: testInfo.outputPath(`${locale}-directions-expanded.png`) });
    // Let the wallet SDK finish its background HEAD probe before navigating.
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(arrival.getByRole("img")).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
});
