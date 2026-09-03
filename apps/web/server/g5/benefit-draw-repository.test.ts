import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  BenefitDrawRepositoryError,
  createSupabaseBenefitDrawRepository,
} from "./benefit-draw-repository";

const result = {
  drawId: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  algorithm: "sha256-weighted-rank-v1",
  seedHash: "a".repeat(64),
  executedAt: "2026-09-04T00:00:00.000Z",
  candidateCount: 2,
  winners: [{
    winnerId: "33333333-3333-4333-8333-333333333333",
    benefitId: "44444444-4444-4444-8444-444444444444",
    appUserId: "55555555-5555-4555-8555-555555555555",
    weight: 4,
  }],
  replayed: false,
};
describe("Benefit draw repository", () => {
  it("calls the single draw RPC and parses the canonical result", async () => {
    const rpc = vi.fn(async () => ({ data: result, error: null }));
    const repository = createSupabaseBenefitDrawRepository({ url: "x", serviceRoleKey: "x" }, { rpc } as never);
    await expect(repository.execute({
      actor: { appUserId: "55555555-5555-4555-8555-555555555555", allowlistId: "66666666-6666-4666-8666-666666666666" },
      correlationId: "77777777-7777-4777-8777-777777777777",
      campaignId: result.campaignId,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
      now: new Date(result.executedAt),
    })).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("maps a second draw under a new key to an immutable conflict", async () => {
    const repository = createSupabaseBenefitDrawRepository(
      { url: "x", serviceRoleKey: "x" },
      { rpc: vi.fn(async () => ({ data: null, error: { message: "PHASE4_BENEFIT_DRAW_ALREADY_EXECUTED" } })) } as never,
    );
    await expect(repository.execute({
      actor: { appUserId: result.winners[0].appUserId, allowlistId: "66666666-6666-4666-8666-666666666666" },
      correlationId: "77777777-7777-4777-8777-777777777777",
      campaignId: result.campaignId,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
      now: new Date(result.executedAt),
    })).rejects.toEqual(expect.objectContaining<Partial<BenefitDrawRepositoryError>>({ code: "ALREADY_EXECUTED" }));
  });
});
