import { describe, expect, it } from "vitest";
import { benefitScorePercent, fanTierProgress, latestCertificationHistory, localizedPath, nextRaffleBoundary, rankedPassportCreators, recommendCertification, selectOpenRaffle, type MyCreator } from "./my-progress";

function creator(slug: string, tier: "Bronze" | "Silver" | "Gold", score: number): MyCreator {
  return { celebrity: { slug, name: slug, image: "/test.jpg" }, relationship: "passport", passport: { id: slug, tier, score, remainingToNextTier: 0 }, ticketBalance: 0, firstReaction: null };
}

describe("MY representative and benefit score", () => {
  it("uses attained tier before points and deterministic slugs for ties without changing the source", () => {
    const source = [creator("zebra", "Silver", 25), creator("bronze", "Bronze", 100), creator("alpha", "Silver", 25), creator("gold", "Gold", 0)];
    expect(rankedPassportCreators(source).map(c => c.celebrity.slug)).toEqual(["gold", "alpha", "zebra", "bronze"]);
    expect(source[0].celebrity.slug).toBe("zebra");
  });
  it("does not manufacture a tier for first-reaction-only fans", () => {
    expect(rankedPassportCreators([{ ...creator("first", "Bronze", 0), passport: null, relationship: "first_reaction_only" }])).toEqual([]);
  });
  it("shows only the score condition, clamps it and omits a zero threshold", () => {
    expect(benefitScorePercent(3, 15)).toBe(20);
    expect(benefitScorePercent(25, 15)).toBe(100);
    expect(benefitScorePercent(0, 0)).toBeNull();
  });
});

describe("MY selected favorite panels", () => {
  it("uses the attained tier and server remaining points for the next threshold and terminates Diamond", () => {
    expect(fanTierProgress(creator("kara", "Silver", 15).passport!)).toMatchObject({ nextTier: "Gold", nextThreshold: 15, remaining: 0, maxed: false });
    expect(fanTierProgress({ id: "x", tier: "Bronze", score: 2, remainingToNextTier: 13 })).toEqual({ nextTier: "Silver", nextThreshold: 15, remaining: 13, percent: 13, maxed: false });
    expect(fanTierProgress({ id: "x", tier: "Diamond", score: 251, remainingToNextTier: 99 })).toEqual({ nextTier: null, nextThreshold: null, remaining: 0, percent: 100, maxed: true });
  });

  it("selects only a currently open raffle with a benefit and stable earliest closing order", () => {
    const base = { title: "Prize", summary: "Summary", imageUrl: null, winnerQuantity: 1, status: "open" as const, entryOpensAt: "2026-09-10T00:00:00Z", entryClosesAt: "2026-09-10T12:00:00Z", fulfillmentMethod: "digital" as const, perFanTicketLimit: null };
    const raffles = [
      { ...base, id: "00000000-0000-4000-8000-000000000003", benefitId: "10000000-0000-4000-8000-000000000003", status: "closed" as const },
      { ...base, id: "00000000-0000-4000-8000-000000000002", benefitId: "10000000-0000-4000-8000-000000000002" },
      { ...base, id: "00000000-0000-4000-8000-000000000001", benefitId: "10000000-0000-4000-8000-000000000001" },
      { ...base, id: "00000000-0000-4000-8000-000000000004", benefitId: null },
    ];
    expect(selectOpenRaffle(raffles, new Date("2026-09-10T00:00:00Z"))?.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(selectOpenRaffle(raffles, new Date("2026-09-10T11:59:59.999Z"))?.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(selectOpenRaffle(raffles, new Date("2026-09-10T12:00:00Z"))).toBeNull();
    expect(selectOpenRaffle(raffles, new Date("2026-09-10T12:00:01Z"))).toBeNull();
    expect(nextRaffleBoundary([{ ...base, id: "00000000-0000-4000-8000-000000000005", benefitId: "10000000-0000-4000-8000-000000000005", status: "preparing", entryOpensAt: "2026-09-10T01:00:00Z" }], Date.parse("2026-09-10T00:00:00Z"))).toEqual({ at: Date.parse("2026-09-10T01:00:00Z"), opens: true });
  });

  it("refreshes an opening raffle when another raffle closes at the same instant", () => {
    const base = { id: "00000000-0000-4000-8000-000000000001", benefitId: "10000000-0000-4000-8000-000000000001", title: "Prize", summary: "Summary", imageUrl: null, winnerQuantity: 1, status: "open" as const, entryOpensAt: "2026-09-10T00:00:00Z", entryClosesAt: "2026-09-10T12:00:00Z", fulfillmentMethod: "digital" as const, perFanTicketLimit: null };
    const opening = { ...base, status: "preparing" as const, entryOpensAt: base.entryClosesAt, entryClosesAt: "2026-09-11T00:00:00Z" };
    expect(nextRaffleBoundary([base, opening], Date.parse("2026-09-10T11:00:00Z"))).toEqual({ at: Date.parse(base.entryClosesAt), opens: true });
  });

  it("uses only the latest stable certification result and allows rejected available missions", () => {
    const missionId = "20000000-0000-4000-8000-000000000001";
    const mission = { id: missionId, kind: "manual" as const, category: "Proof", title: "Ticket proof", description: "Upload proof", status: "available" as const, reward: { scorePoints: 2, ticketAmount: 1 }, actionHref: "/c/kara/certifications/manual" };
    const item = (id: string, status: "pending" | "approved" | "rejected", submittedAt: string) => ({ id, kind: "manual" as const, missionId, title: mission.title, status, attemptNumber: 1, rejectionReason: null, submittedAt, reviewedAt: null, actionHref: mission.actionHref });
    const rejected = item("30000000-0000-4000-8000-000000000001", "rejected", "2026-09-09T00:00:00Z");
    const pending = item("30000000-0000-4000-8000-000000000002", "pending", "2026-09-10T00:00:00Z");
    expect(recommendCertification([mission], [rejected], true)).toEqual(mission);
    expect(recommendCertification([mission], [rejected, pending], true)).toBeNull();
    expect(latestCertificationHistory([pending, { ...pending, id: "30000000-0000-4000-8000-000000000003", status: "approved" }]).get(`manual:${missionId}`)?.status).toBe("approved");
    expect(latestCertificationHistory([pending, { ...pending, id: "30000000-0000-4000-8000-000000000004", status: "approved", submittedAt: "2026-09-10T09:00:00+09:00", attemptNumber: 2 }]).get(`manual:${missionId}`)?.status).toBe("approved");
    expect(recommendCertification([{ ...mission, id: "20000000-0000-4000-8000-000000000002", kind: "quiz" }], [], true)).toBeNull();
  });

  it("localizes only safe in-app mission paths while preserving query and hash", () => {
    expect(localizedPath("/c/kara/certifications?tab=manual&locale=en#mission", "ko")).toBe("/c/kara/certifications?tab=manual&locale=ko#mission");
    expect(localizedPath("//evil.example/path", "ko")).toBeNull();
    expect(localizedPath("/safe\\evil", "ko")).toBeNull();
  });
});
