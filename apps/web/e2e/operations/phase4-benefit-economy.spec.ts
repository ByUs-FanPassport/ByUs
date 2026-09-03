import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const ids = (process.env.BYUS_PHASE4_BENEFIT_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const stage = process.env.BYUS_PHASE4_STAGE ?? "entry";
const evidenceRoot = path.resolve(
  process.cwd(),
  "../../artifacts/e2e/phase4-benefit-economy",
);

function stableUuid(scope: string) {
  const bytes = Buffer.from(
    createHash("sha256").update(`phase4:${scope}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test.beforeAll(() => {
  if (ids.length < 3) throw new Error("PHASE4_E2E_REQUIRES_THREE_BENEFITS");
});

test("Benefit entry and owned Reward projection remain responsive and private", async ({
  page,
}, testInfo) => {
  const selected = testInfo.project.name.includes("360") ? ids[0] : ids[1];
  if (!selected) throw new Error("PHASE4_E2E_BENEFIT_MISSING");
  await page.goto(`/benefits/${selected}?locale=ko`);

  if (stage === "entry") {
    const amount = testInfo.project.name.includes("360") ? 2 : 3;
    await page.evaluate(
      ({ benefitId, idempotencyKey }) =>
        localStorage.setItem(
          `byus:benefit-entry:${benefitId}`,
          idempotencyKey,
        ),
      {
        benefitId: selected,
        idempotencyKey: stableUuid(`${testInfo.project.name}:${selected}`),
      },
    );
    const input = page.getByRole("spinbutton", { name: "응모할 Ticket 수" });
    await expect(input).toBeVisible();
    await input.fill(String(amount));
    await page.getByRole("button", { name: "Ticket으로 응모하기" }).click();
    await expect(page.getByText(new RegExp(`${amount} Ticket`)).first()).toBeVisible();
  } else {
    const rewards = await page.evaluate(async () => {
      const raw = localStorage.getItem("privy:token");
      const token = raw ? JSON.parse(raw) : null;
      const response = await fetch("/api/me/rewards", {
        headers: { authorization: `Bearer ${token}` },
      });
      return { status: response.status, body: await response.json() };
    });
    expect(rewards.status).toBe(200);
    expect(rewards.body.rewards.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(rewards.body)).not.toMatch(
      /"(?:name|phone|postalCode|address1|address2)"/,
    );
    expect(
      rewards.body.rewards.map((reward: { method: string | null }) => reward.method),
    ).toEqual(
      expect.arrayContaining(["digital", "physical_shipping", "on_site_pickup"]),
    );
  }

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceRoot, `phase4-${stage}-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
