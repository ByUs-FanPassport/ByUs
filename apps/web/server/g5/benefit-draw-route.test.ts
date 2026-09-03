import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPostBenefitDrawHandler, type BenefitDrawRouteDependencies } from "./benefit-draw-route";

const campaignId = "11111111-1111-4111-8111-111111111111";
function dependencies(role: "admin" | "operator" | "viewer" = "admin"): BenefitDrawRouteDependencies {
  return {
    authorize: vi.fn(async () => ({ appUserId: "22222222-2222-4222-8222-222222222222", allowlistId: "33333333-3333-4333-8333-333333333333", email: "admin@byus.test", role })),
    repository: { execute: vi.fn(async () => ({ drawId: "44444444-4444-4444-8444-444444444444", campaignId, algorithm: "sha256-weighted-rank-v1" as const, seedHash: "a".repeat(64), executedAt: "2026-09-04T00:00:00.000Z", candidateCount: 0, winners: [], replayed: false })) },
    now: () => new Date("2026-09-04T00:00:00Z"),
  };
}
const request = () => new Request(`https://byus.test/api/admin/benefit-campaigns/${campaignId}/draw`, {
  method: "POST",
  headers: { authorization: "Bearer token", "content-type": "application/json", "x-correlation-id": "55555555-5555-4555-8555-555555555555" },
  body: JSON.stringify({ idempotencyKey: "66666666-6666-4666-8666-666666666666" }),
});
describe("Benefit draw route", () => {
  it.each(["admin", "operator"] as const)("allows %s to execute the single RPC", async (role) => {
    const d = dependencies(role);
    const response = await createPostBenefitDrawHandler(d)(request(), { campaignId });
    expect(response.status).toBe(200);
    expect(d.repository.execute).toHaveBeenCalledTimes(1);
  });
  it("keeps viewers read-only", async () => {
    const d = dependencies("viewer");
    const response = await createPostBenefitDrawHandler(d)(request(), { campaignId });
    expect(response.status).toBe(403);
    expect(d.repository.execute).not.toHaveBeenCalled();
  });
});
