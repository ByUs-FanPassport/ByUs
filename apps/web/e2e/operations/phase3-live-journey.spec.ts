import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const eligibleToken = process.env.BYUS_PHASE3_ELIGIBLE_FAN_TOKEN?.trim() ?? "";
const incompleteToken = process.env.BYUS_PHASE3_INCOMPLETE_FAN_TOKEN?.trim() ?? "";
const journeyProofKey = process.env.BYUS_PHASE3_JOURNEY_IDEMPOTENCY_KEY?.trim() ?? stableUuid("journey-complete", eligibleToken);
const claimProofKey = process.env.BYUS_PHASE3_CLAIM_IDEMPOTENCY_KEY?.trim() ?? stableUuid("collectible-claim", eligibleToken);
const privyStoragePath = process.env.BYUS_PHASE3_PRIVY_STORAGE_PATH?.trim() ?? "";
const privyStorage = privyStoragePath
  ? JSON.parse(readFileSync(privyStoragePath, "utf8")) as Record<string, string>
  : { "privy:token": JSON.stringify(eligibleToken) };
const claimLiveSlug = process.env.BYUS_PHASE3_CLAIM_LIVE_SLUG?.trim() ?? "p3-collectible-20260904";
const providerLives = [
  ["2026-09", "p3-youtube-20260930", "https://www.youtube.com/watch?v=byusP3Close"],
  ["2026-10", "p3-instagram-20261001", "https://www.instagram.com/byus.official/live/"],
  ["2026-10", "p3-tiktok-20261002", "https://www.tiktok.com/@byus.official/live"],
] as const;
const evidenceRoot = path.resolve(process.cwd(), "../../artifacts/e2e/phase3-live-journey");

function stableUuid(scope: string, identity: string) {
  const bytes = Buffer.from(createHash("sha256").update(`phase3:${scope}:${identity}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const authorization = (token: string) => ({ authorization: `Bearer ${token}` });

async function authenticate(page: import("@playwright/test").Page, token: string) {
  await page.addInitScript((storage) => {
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  }, privyStorage);
  await page.goto("/");
  await page.evaluate((value) => localStorage.setItem("privy:token", JSON.stringify(value)), token);
}

test.beforeAll(() => {
  const missing = [["BYUS_PHASE3_ELIGIBLE_FAN_TOKEN", eligibleToken]]
    .filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`PHASE3_E2E_PREFLIGHT_MISSING: ${missing.join(", ")}`);
});

test("calendar, provider targets, Journey completion, claim replay, and reload stay canonical", async ({ page, request }, testInfo) => {
  for (const [month, slug, target] of providerLives) {
    const calendarResponse = await request.get(`/api/live-events/calendar?month=${month}&locale=ko`, { headers: authorization(eligibleToken) });
    expect(calendarResponse.status(), await calendarResponse.text()).toBe(200);
    const calendar = await calendarResponse.json();
    expect(calendar.days.flatMap((day: any) => day.events).some((event: any) => event.slug === slug)).toBe(true);

    const liveResponse = await request.get(`/api/live-events/${slug}?locale=ko`, { headers: authorization(eligibleToken) });
    expect(liveResponse.status(), await liveResponse.text()).toBe(200);
    expect((await liveResponse.json()).live.watch.url).toBe(target);
  }

  if (incompleteToken) {
    const incompleteKey = stableUuid("journey-incomplete", incompleteToken);
    const incompleteResponse = await request.post(`/api/live-events/${claimLiveSlug}/journey`, {
      headers: { ...authorization(incompleteToken), "content-type": "application/json" },
      data: { idempotencyKey: incompleteKey },
    });
    expect(incompleteResponse.status(), await incompleteResponse.text()).toBe(200);
    const incomplete = await incompleteResponse.json();
    expect(incomplete).toMatchObject({ complete: false, completedAt: null, ticketLedgerId: null });
  }

  const journeyResponse = await request.post(`/api/live-events/${claimLiveSlug}/journey`, {
    headers: { ...authorization(eligibleToken), "content-type": "application/json" },
    data: { idempotencyKey: journeyProofKey },
  });
  expect(journeyResponse.status(), await journeyResponse.text()).toBe(200);
  const journey = await journeyResponse.json();
  expect(journey).toMatchObject({ complete: true, bonusTicketAmount: 3 });
  expect(journey.completedAt).toBeTruthy();
  expect(journey.ticketLedgerId).toBeTruthy();

  const claimResponse = await request.post(`/api/live-events/${claimLiveSlug}/collectible`, {
    headers: { ...authorization(eligibleToken), "content-type": "application/json" },
    data: { idempotencyKey: claimProofKey },
  });
  expect(claimResponse.status(), await claimResponse.text()).toBe(200);
  const claimed = await claimResponse.json();
  expect(claimed.claim).toMatchObject({ liveEventId: journey.liveEventId, journeyCompletionId: expect.any(String) });

  const replayResponse = await request.post(`/api/live-events/${claimLiveSlug}/collectible`, {
    headers: { ...authorization(eligibleToken), "content-type": "application/json" },
    data: { idempotencyKey: claimProofKey },
  });
  expect(replayResponse.status(), await replayResponse.text()).toBe(200);
  expect(await replayResponse.json()).toMatchObject({ replayed: true, claim: { id: claimed.claim.id } });

  const freshKeyConflict = await request.post(`/api/live-events/${claimLiveSlug}/collectible`, {
    headers: { ...authorization(eligibleToken), "content-type": "application/json" },
    data: { idempotencyKey: stableUuid("collectible-conflict", eligibleToken) },
  });
  expect(freshKeyConflict.status()).toBe(409);
  expect(await freshKeyConflict.json()).toEqual({ error: { code: "IDEMPOTENCY_CONFLICT" } });

  await authenticate(page, eligibleToken);
  await page.goto(`/live/calendar?month=2026-09&locale=ko`);
  await expect(page.getByRole("link", { name: /p3-youtube|Phase 3 YouTube/i }).first()).toBeVisible();
  await page.goto(`/live/${claimLiveSlug}?locale=ko`);
  await expect(page.getByRole("heading", { name: "Digital Collectible" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Collectible 받기/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Claim 완료|발급 완료/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({ path: path.join(evidenceRoot, `phase3-${testInfo.project.name}.png`), fullPage: true });
});
