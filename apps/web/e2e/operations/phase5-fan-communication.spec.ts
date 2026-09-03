import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const token = process.env.BYUS_PHASE5_FAN_ACCESS_TOKEN?.trim() ?? "";
const root = path.resolve(process.cwd(), "../../artifacts/e2e/phase5-fan-communication");

async function authenticate(page: import("@playwright/test").Page) {
  await page.addInitScript(
    (accessToken) => localStorage.setItem("privy:token", JSON.stringify(accessToken)),
    token,
  );
}

test.beforeAll(() => {
  if (!token) throw new Error("PHASE5_E2E_FAN_ACCESS_TOKEN_MISSING");
});

test("MY and channel settings stay responsive, linked, and private", async ({ page, request }, info) => {
  const headers = { authorization: `Bearer ${token}` };
  const summary = await request.get("/api/me/summary?locale=ko", { headers });
  expect(summary.status()).toBe(200);
  const payload = await summary.json();
  expect(payload.summary).toEqual(expect.objectContaining({
    creators: expect.any(Array),
    live: expect.any(Object),
    rewards: expect.any(Object),
    collection: expect.any(Object),
  }));
  expect(JSON.stringify(payload)).not.toMatch(/"(?:wallet|address|phone|postalCode|destination|recipientKey)"/i);

  const channels = await request.get("/api/me/notification-channels", { headers });
  expect(channels.status()).toBe(200);
  const connections = await channels.json();
  expect(JSON.stringify(connections)).not.toMatch(/phase5-(?:qa-)?test-recipient|phase5-(?:qa-)?@example\.invalid/);

  await authenticate(page);
  for (const route of ["/my?locale=ko", "/settings?locale=ko"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await mkdir(root, { recursive: true });
    await page.screenshot({
      path: path.join(root, `${route.includes("settings") ? "settings" : "my"}-${info.project.name}.png`),
      fullPage: true,
    });
  }

  await expect(page.getByRole("heading", { name: "설정" })).toBeVisible();
  await expect(page.getByText(/Google.*읽기 전용/)).toBeVisible();
  await expect(page.getByRole("switch", { name: "Email 수신" })).toBeVisible();
});
