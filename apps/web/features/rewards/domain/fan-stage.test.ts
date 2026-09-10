import { describe, expect, it } from "vitest";
import { FAN_STAGE_KEYS, fanStageLabel, fanStageProgressSchema, fanStageSchema, fanTierEntryKey } from "./fan-stage";

const silver1 = { key: "silver-1", tier: "Silver", subdivision: 1, rank: 2, minimumScore: 15 } as const;
const silver2 = { key: "silver-2", tier: "Silver", subdivision: 2, rank: 3, minimumScore: 30 } as const;
const progress = { policyVersion: 2, current: silver1, next: silver2, remaining: 8, progressPercent: 46 };

describe("server fan stage contract", () => {
  it("preserves server values and labels subdivisions without deriving score thresholds", () => {
    expect(fanStageProgressSchema.parse(progress)).toEqual(progress);
    expect(fanStageLabel("ko", silver2)).toBe("실버 2");
    expect(fanStageLabel("en", silver1)).toBe("Silver 1");
    expect(fanStageLabel("ko", { tier: "Bronze", subdivision: 1 })).toBe("브론즈");
    expect(fanStageLabel("en", { tier: "Diamond", subdivision: 1 })).toBe("Diamond");
    expect(fanTierEntryKey("Gold")).toBe("gold-1");
  });

  it("accepts all eleven asset identities and rejects mismatched rank or tier", () => {
    for (const [index, key] of FAN_STAGE_KEYS.entries()) {
      const [material, subdivision] = key.split("-");
      const tier = material[0].toUpperCase() + material.slice(1);
      expect(fanStageSchema.safeParse({ key, tier, subdivision: Number(subdivision), rank: index + 1, minimumScore: 0 }).success).toBe(true);
    }
    expect(fanStageSchema.safeParse({ ...silver1, key: "gold-1" }).success).toBe(false);
    expect(fanStageSchema.safeParse({ ...silver1, rank: 3 }).success).toBe(false);
  });

  it.each([
    { ...progress, progressPercent: 101 },
    { ...progress, remaining: -1 },
    { ...progress, next: null },
    { ...progress, next: { ...silver2, minimumScore: 14 } },
    { ...progress, policyVersion: 1 },
    { ...progress, privateOwnerId: "private" },
  ])("rejects invalid stage projection %#", (value) => {
    expect(fanStageProgressSchema.safeParse(value).success).toBe(false);
  });

  it("requires a complete maximum stage", () => {
    const maximum = { ...progress, current: { key: "diamond-1", tier: "Diamond", subdivision: 1, rank: 11, minimumScore: 250 }, next: null, remaining: 0, progressPercent: 100 };
    expect(fanStageProgressSchema.safeParse(maximum).success).toBe(true);
    expect(fanStageProgressSchema.safeParse({ ...maximum, remaining: 1 }).success).toBe(false);
  });
});
