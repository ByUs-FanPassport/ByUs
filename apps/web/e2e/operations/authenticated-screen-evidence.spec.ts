import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../fixtures/protected-preview";

const token = process.env.BYUS_E2E_FAN_ACCESS_TOKEN?.trim() ?? "";
const runId = process.env.BYUS_E2E_RUN_ID?.trim().toLowerCase() ?? "";
const liveSlug = `e2e-kara-nualeaf-${runId}`;
const evidenceRoot = path.resolve(process.cwd(), "../../artifacts/e2e/g6-release/authenticated");

async function authenticate(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate((accessToken) => localStorage.setItem("privy:token", JSON.stringify(accessToken)), token);
}

async function capture(page: import("@playwright/test").Page, screenId: string, projectName: string) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("AUTHENTICATED_EVIDENCE_VIEWPORT_MISSING");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${screenId} must not overflow horizontally`).toBeLessThanOrEqual(1);
  const directory = path.join(evidenceRoot, screenId);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${screenId}-${projectName}.png`), fullPage: true });
}

test.beforeAll(() => {
  if (!token || !runId) throw new Error("AUTHENTICATED_SCREEN_EVIDENCE_ENV_MISSING");
});

test("captures authenticated fan credential, live, survey and benefit surfaces", async ({ page, request }, testInfo) => {
  const headers = { authorization: `Bearer ${token}` };
  const passportResponse = await request.get("/api/passports?locale=ko", { headers });
  expect(passportResponse.status()).toBe(200);
  const passportPayload = await passportResponse.json();
  const passport = passportPayload.passports.find((item: any) => item.celebrity?.slug === "kara");
  expect(passport).toBeTruthy();

  const detailResponse = await request.get(`/api/passports/${passport.id}?locale=ko`, { headers });
  expect(detailResponse.status()).toBe(200);
  const detailPayload = await detailResponse.json();
  const stamp = detailPayload.passport.stamps[0];
  expect(stamp).toBeTruthy();

  const benefitResponse = await request.get("/api/benefits?celebrity=kara&locale=ko", { headers });
  expect(benefitResponse.status()).toBe(200);
  const benefitPayload = await benefitResponse.json();
  const benefit = benefitPayload.benefits.find((item: any) => item.slug === `${liveSlug}-direct`);
  expect(benefit).toBeTruthy();

  await authenticate(page);
  const fanScreens = [
    ["FAN-010", "/passports?locale=ko"],
    ["FAN-011", `/passports/${passport.id}?locale=ko`],
    ["FAN-012", `/stamps/${stamp.id}?locale=ko`],
    ["FAN-013", `/live/${liveSlug}?locale=ko`],
    ["FAN-015", `/live/${liveSlug}?locale=ko`],
    ["FAN-016", `/live/${liveSlug}/survey?locale=ko`],
    ["FAN-017", "/benefits?celebrity=kara&locale=ko"],
    ["FAN-018", `/benefits/${benefit.id}?locale=ko`],
  ] as const;
  for (const [screenId, route] of fanScreens) {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    await capture(page, screenId, testInfo.project.name);
  }
});

test("captures every implemented administrator surface", async ({ page }, testInfo) => {
  await authenticate(page);
  const adminScreens = [
    ["ADM-002", "/admin/dashboard"],
    ["ADM-003", "/admin/celebrities"],
    ["ADM-005", "/admin/lives"],
    ["ADM-007", "/admin/benefits"],
    ["ADM-008", "/admin/dashboard?view=creator"],
    ["ADM-009", "/admin/dashboard?view=brand"],
    ["ADM-010", "/admin/fans"],
    ["ADM-011", "/admin/blockchain-jobs"],
    ["ADM-012", "/admin/audit"],
  ] as const;
  for (const [screenId, route] of adminScreens) {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/admin\/login/);
    await capture(page, screenId, testInfo.project.name);
  }
});
