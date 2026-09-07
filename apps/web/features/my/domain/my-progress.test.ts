import { describe, expect, it } from "vitest";
import { benefitScorePercent, rankedPassportCreators, type MyCreator } from "./my-progress";

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
