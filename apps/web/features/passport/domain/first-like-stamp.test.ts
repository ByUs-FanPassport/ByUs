import { describe, expect, it } from "vitest";
import { boundFirstLikeCount, passportStampDisplay, type FirstReactionStamp } from "./first-like-stamp";
import { stampTypeSchema } from "./passport-read-model";

const firstReaction: FirstReactionStamp = {
  reactionId: "11111111-1111-4111-8111-111111111111",
  stampId: "22222222-2222-4222-8222-222222222222",
  activityId: "33333333-3333-4333-8333-333333333333",
  reactionType: "FirstReaction", mintStatus: "queued", txHash: null,
  issuedAt: "2026-09-11T00:00:00Z",
};

describe("First Like display entitlement", () => {
  it("keeps old records without a like unchanged", () => {
    expect(passportStampDisplay({ stamps: [], stampSummary: { total: 0 } })).toEqual({ stamps: [], totalCount: 0 });
  });
  it("counts a pending like once even when the projection is reused, without points or changing business totals", () => {
    const input = { stamps: [{ id: "normal", type: "knowledge" as const, issuedAt: firstReaction.issuedAt, points: 1 }], stampSummary: { total: 1 }, firstReaction };
    const once = passportStampDisplay(input);
    const again = passportStampDisplay({ ...input, stamps: once.stamps });
    expect(again).toEqual(once);
    expect(once.totalCount).toBe(2);
    expect(once.stamps.filter(s => s.type === "first_reaction")).toEqual([{ id: firstReaction.stampId, type: "first_reaction", issuedAt: firstReaction.issuedAt }]);
    expect(input.stampSummary.total).toBe(1);
    expect(input.stamps).toHaveLength(1);
    expect(stampTypeSchema.safeParse("first_reaction").success).toBe(false);
  });
  it("keeps separate genuine stamps of the same type", () => {
    const stamps = ["one", "two"].map(id => ({ id, type: "knowledge" as const, issuedAt: firstReaction.issuedAt }));
    expect(passportStampDisplay({ stamps, stampSummary: { total: 2 }, firstReaction }).stamps).toHaveLength(3);
  });
  it("adds the retained pre-verification like only after a Passport exists, with no duplicate passport count", () => {
    const creator = { passport: null as { id: string } | null, firstReaction: { completedAt: firstReaction.issuedAt } };
    expect(boundFirstLikeCount([creator])).toBe(0);
    const bound = { ...creator, passport: { id: "passport" } };
    expect(boundFirstLikeCount([bound, bound, { passport: { id: "other" }, firstReaction: null }])).toBe(1);
  });
});
