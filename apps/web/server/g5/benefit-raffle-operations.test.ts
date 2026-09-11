import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPostRaffleRosterHandler, createCloseRaffleClaimHandler, createRafflePolicyHandler, raffleRosterCsvCell, type RaffleOperationsDependencies } from "./benefit-raffle-operations";
const id = "11111111-1111-4111-8111-111111111111";
function deps(role: "admin" | "viewer" = "admin"): RaffleOperationsDependencies {
  return { authorize: vi.fn(async () => ({ appUserId: "actor", allowlistId: "allow", email: "admin@example.test", role })), repository: {
    policy: vi.fn(async () => null), configure: vi.fn(), close: vi.fn(async () => ({ claimDisposition: "unclaimed" })),
    roster: vi.fn(async () => ({ rosterVersion: "v1", generatedAt: "2026-09-11T00:00:00Z", items: [{ winnerId: id, benefitId: id, benefitTitle: "관람권", name: " =FORMULA()", phoneLast4: "5678", fulfillmentStatus: "pickup_available" }] })),
  } };
}
const post = (body: unknown) => new Request("https://byus.test/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
describe("raffle operations authorization and data minimization", () => {
  it("denies viewer export, policy mutation and claim closure before DB calls", async () => {
    const d = deps("viewer");
    expect((await createPostRaffleRosterHandler(d)(post({ purpose: "현장 운영 명단을 확인합니다" }), { campaignId: id })).status).toBe(403);
    expect((await createRafflePolicyHandler(d)(post({}), { campaignId: id, benefitId: id })).status).toBe(403);
    expect((await createCloseRaffleClaimHandler(d)(post({}), { winnerId: id })).status).toBe(403);
    expect(d.repository.roster).not.toHaveBeenCalled(); expect(d.repository.close).not.toHaveBeenCalled(); expect(d.repository.configure).not.toHaveBeenCalled();
  });
  it("exports only venue columns with formula escaping and a private response", async () => {
    const d = deps(); const response = await createPostRaffleRosterHandler(d)(post({ purpose: "현장 수령자 명단 대조 목적" }), { campaignId: id });
    const csv = await response.text(); expect(csv).toContain("뒤 4자리"); expect(csv).toContain("' =FORMULA()"); expect(csv).not.toContain(id);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-roster-version")).toBe("v1");
    expect(d.repository.roster).toHaveBeenCalledWith(expect.objectContaining({ actor: { appUserId: "actor", allowlistId: "allow" }, purpose: "현장 수령자 명단 대조 목적" }));
  });
  it("rejects missing audit purpose and maps close races to conflict", async () => {
    const d = deps(); expect((await createPostRaffleRosterHandler(d)(post({ purpose: "" }), { campaignId: id })).status).toBe(400);
    vi.mocked(d.repository.close).mockRejectedValueOnce(new Error("RAFFLE_FULFILLMENT_REVISION_CONFLICT"));
    expect((await createCloseRaffleClaimHandler(d)(post({ expectedRevision: 2, reason: "기한 경과 및 미제출 확인 완료" }), { winnerId: id })).status).toBe(409);
  });
  it.each([
    { pickupEndsOn: null }, { pickupEndsOn: "2026-02-30" },
    { pickupVenue: { ko: " ", en: "Venue" } },
    { pickupInstructions: { ko: "현장 확인", en: " " } },
  ])("rejects incomplete onsite activation before the DB call: %j", async (invalid) => {
    const d = deps();
    const policy = { version: "v1", method: "on_site_pickup", shippingCountry: null, requiresShippingAcknowledgment: false, recipientWindowDays: 7, pickupEndsOn: "2026-11-03", pickupVenue: { ko: "전시장", en: "Venue" }, pickupInstructions: { ko: "현장 확인", en: "Verify at venue" }, ...invalid };
    expect((await createRafflePolicyHandler(d)(post({ expectedRevision: 1, policy }), { campaignId: id, benefitId: id })).status).toBe(400);
    expect(d.repository.configure).not.toHaveBeenCalled();
  });
  it.each(["=1", "+1", "-1", "@x", "  =x", "\tx"])("neutralizes %j in CSV", value => { expect(raffleRosterCsvCell(value)).toBe(`"'${value}"`); });
});
