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
  await page.locator('#rsvp-residentRegistrationNumber').fill("900101");
  await page.locator('#rsvp-registration-part-1').fill("1");
  await page.locator('#rsvp-registration-part-2').fill("234567");
  await page.locator('[name="affiliation"]').fill("샐리랩");
  await page.locator('[name="occupation"]').fill("프로듀서");
  await page.locator('[name="email"]').fill("guest@example.com");
  await page.locator('[name="consent"]').check();
}

test("keeps staff route, languages, metadata and privacy dialog isolated", async ({ page, request }) => {
  const redirect = await request.get("/kyaa-wave/staff?locale=ko", { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toContain("/connect/kyaa-wave/staff?locale=ko");
  for (const locale of ["ko", "en"]) {
    await page.goto(`/kyaa-wave/staff?locale=${locale}`);
    await expect(page.locator("#rsvp h2")).toHaveText(locale === "ko" ? "스태프 참가 신청" : "Staff RSVP");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/images\/connect\/kyaa-wave\/share-20261008\.jpg$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator('[name="nationality"]')).toHaveValue("KR");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const privacy = page.getByRole("button", { name: locale === "ko" ? "일반 개인정보 수집·이용 안내" : "Personal information collection and use", exact: true });
    await privacy.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(privacy).toBeFocused();
  }
  await page.getByRole("link", { name: "한국어", exact: true }).click();
  await expect(page).toHaveURL(/\/connect\/kyaa-wave\/staff/);
  await expect(page.locator("#rsvp h2")).toHaveText("스태프 참가 신청");
});

test("validates required fields and announces errors without sending a request", async ({ page }) => {
  let sent = false;
  await page.route("**/api/byus-day/rsvp/staff", route => { sent = true; return route.abort(); });
  await page.goto("/kyaa-wave/staff?locale=ko");
  await expect(page).toHaveURL(/\/connect\/kyaa-wave\/staff(?:\?locale=ko)?$/);
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
  await page.route("**/api/byus-day/rsvp/staff", route => {
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) mockedFailureStatuses.add(503);
    return route.fulfill({ status: payloads.length === 1 ? 503 : 202, contentType: "application/json", body: JSON.stringify(payloads.length === 1 ? { error: { code: "RSVP_UNAVAILABLE" } } : { status: "accepted" }) });
  });
  await page.goto("/connect/kyaa-wave/staff?locale=ko");
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
  await page.route("**/api/byus-day/rsvp/staff", route => {
    mockedFailureStatuses.add(410);
    return route.fulfill({ status:410, contentType:"application/json", body:JSON.stringify({ error:{ code:"RSVP_CLOSED" } }) });
  });
  await page.goto("/connect/kyaa-wave/staff?locale=ja");
  await expect(page.locator('[lang="en"]').getByRole("heading", { name:"Staff RSVP", exact:true })).toBeVisible();
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

