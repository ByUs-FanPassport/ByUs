import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../fixtures/protected-preview";

const fanToken = process.env.BYUS_RELEASE_FAN_ACCESS_TOKEN?.trim() ?? "";
const adminToken = process.env.BYUS_RELEASE_ADMIN_ACCESS_TOKEN?.trim() ?? "";
const liveId = process.env.BYUS_RELEASE_LIVE_ID?.trim() ?? "";
const liveSlug = process.env.BYUS_RELEASE_LIVE_SLUG?.trim() ?? "";
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const evidenceRoot = path.resolve(process.cwd(), "../../artifacts/e2e/ppt-full-release");

async function authenticate(page: import("@playwright/test").Page, token: string) {
  await page.addInitScript((value) => localStorage.setItem("privy:token", JSON.stringify(value)), token);
}

test.beforeAll(() => {
  const missing = [
    ["BYUS_RELEASE_FAN_ACCESS_TOKEN", fanToken], ["BYUS_RELEASE_ADMIN_ACCESS_TOKEN", adminToken],
    ["BYUS_RELEASE_LIVE_ID", liveId], ["BYUS_RELEASE_LIVE_SLUG", liveSlug],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`PPT_RELEASE_E2E_PREFLIGHT_MISSING: ${missing.join(", ")}`);
});

test("one authenticated fixture lineage remains complete and operable", async ({ page, request }, info) => {
  const fanHeaders = headers(fanToken);
  const adminHeaders = headers(adminToken);

  // Canonical owner story: Creator/LIVE calendar, Reaction + Passport attribution,
  // Reservation/Attendance, wrong/correct/Survey/Vote Missions, Journey bonus Ticket,
  // Collectible, repeated Benefit entries/draw/winner/fulfillment, MY and notifications.
  const [calendar, live, summary, channels, notifications] = await Promise.all([
    request.get(`/api/live-events/calendar?month=2026-09&locale=ko`, { headers: fanHeaders }),
    request.get(`/api/live-events/${liveSlug}?locale=ko`, { headers: fanHeaders }),
    request.get("/api/me/summary?locale=ko", { headers: fanHeaders }),
    request.get("/api/me/notification-channels", { headers: fanHeaders }),
    request.get("/api/notifications", { headers: fanHeaders }),
  ]);
  for (const response of [calendar, live, summary, channels, notifications]) expect(response.status(), await response.text()).toBe(200);
  const calendarBody = await calendar.json();
  expect(calendarBody.days.flatMap((day: any) => day.events).some((event: any) => event.id === liveId || event.slug === liveSlug)).toBe(true);
  const summaryBody = (await summary.json()).summary;
  expect(summaryBody).toEqual(expect.objectContaining({ creators: expect.any(Array), live: expect.any(Object), rewards: expect.any(Object), collection: expect.any(Object) }));
  expect(summaryBody.creators.length).toBeGreaterThan(0);
  expect(summaryBody.collection.passports.length).toBeGreaterThan(0);
  expect(JSON.stringify(summaryBody)).not.toMatch(/"(?:address|phone|postalCode|destination|recipientKey)"/i);

  // Recovery/operations and both analytics read models must remain independently readable.
  const [platform, liveAnalytics, jobs, deliveries, purge, audit] = await Promise.all([
    request.get("/api/admin/analytics/platform?preset=30d", { headers: adminHeaders }),
    request.get(`/api/admin/analytics/live-events/${liveId}?preset=30d`, { headers: adminHeaders }),
    request.get("/api/admin/blockchain-jobs", { headers: adminHeaders }),
    request.get("/api/admin/notification-deliveries", { headers: adminHeaders }),
    request.get("/api/admin/maintenance/recipient-purge", { headers: adminHeaders }),
    request.get("/api/admin/audit-logs", { headers: adminHeaders }),
  ]);
  for (const response of [platform, liveAnalytics, jobs, deliveries, purge, audit]) expect(response.status(), await response.text()).toBe(200);
  expect(await purge.json()).toEqual(expect.objectContaining({ state: expect.stringMatching(/healthy|degraded|never_run/) }));

  await authenticate(page, fanToken);
  for (const route of [`/live/calendar?month=2026-09&locale=ko`, `/live/${liveSlug}?locale=ko`, "/my?locale=ko", "/settings?locale=ko", "/notifications?locale=ko"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), route).toBeLessThanOrEqual(1);
  }

  await authenticate(page, adminToken);
  for (const route of ["/admin", "/admin/dashboard?preset=30d", `/admin/lives/${liveId}/analytics?preset=30d`, "/admin/blockchain-jobs?status=FAILED", "/admin/notifications?status=failed"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), route).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole("heading", { name: /알림|Notification/ })).toBeVisible();
  await mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({ path: path.join(evidenceRoot, `release-${info.project.name}.png`), fullPage: true });
});
