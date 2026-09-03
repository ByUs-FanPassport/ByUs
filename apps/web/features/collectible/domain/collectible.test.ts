import { describe, expect, it } from "vitest";

import {
  collectibleClaimSchema,
  collectibleOwnedStateSchema,
  claimCollectibleRequestSchema,
} from "./collectible";

const claim = {
  id: "11111111-1111-4111-8111-111111111111",
  liveEventId: "22222222-2222-4222-8222-222222222222",
  journeyCompletionId: "33333333-3333-4333-8333-333333333333",
  businessStatus: "claimed" as const,
  claimedAt: "2026-09-03T12:00:00.000Z",
  mint: { status: "queued" as const, txHash: null, tokenId: null },
};

describe("Collectible domain", () => {
  it("accepts an owned claim and the half-open frozen claim window", () => {
    expect(collectibleClaimSchema.parse(claim)).toEqual(claim);
    expect(collectibleOwnedStateSchema.parse({
      eligible: true,
      claimWindow: {
        from: "2026-09-03T12:00:00.000Z",
        until: "2026-09-05T12:00:00.000Z",
      },
      claim,
    }).claim).toEqual(claim);
  });

  it("keeps mint lifecycle closed and the claim request strict", () => {
    expect(() => collectibleClaimSchema.parse({
      ...claim,
      mint: { ...claim.mint, status: "unknown" },
    })).toThrow();
    expect(() => claimCollectibleRequestSchema.parse({
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      appUserId: "attacker",
    })).toThrow();
  });
});
