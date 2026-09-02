import { describe, expect, it } from "vitest";

import {
  REWARD_POLICY_V2,
  parseRewardPolicy,
  resolveJourneyCompletionTicket,
  resolveMissionReward,
  tierForScore,
  rewardPolicyForVersion,
} from "./reward-policy";

describe("reward policy v2", () => {
  it.each([
    [0, "Bronze"],
    [14, "Bronze"],
    [15, "Silver"],
    [49, "Silver"],
    [50, "Gold"],
    [119, "Gold"],
    [120, "Platinum"],
    [249, "Platinum"],
    [250, "Diamond"],
  ] as const)("maps score %i to %s", (score, tier) => {
    expect(tierForScore(REWARD_POLICY_V2, score)).toBe(tier);
  });

  it("uses the locked Mission defaults", () => {
    expect(resolveMissionReward(REWARD_POLICY_V2, {})).toEqual({
      score: 1,
      ticket: 1,
    });
  });

  it.each([
    [{ score: 0, ticket: 0 }, { score: 0, ticket: 0 }],
    [{ score: 3, ticket: 2 }, { score: 3, ticket: 2 }],
  ] as const)("accepts Mission rewards at the inclusive bounds", (input, expected) => {
    expect(resolveMissionReward(REWARD_POLICY_V2, input)).toEqual(expected);
  });

  it.each([
    [{ score: -1 }, /mission score/i],
    [{ score: 4 }, /mission score/i],
    [{ ticket: -1 }, /mission ticket/i],
    [{ ticket: 3 }, /mission ticket/i],
  ] as const)("rejects Mission rewards outside policy", (input, error) => {
    expect(() => resolveMissionReward(REWARD_POLICY_V2, input)).toThrowError(error);
  });

  it("uses Journey default 3 and inclusive range 0..5", () => {
    expect(resolveJourneyCompletionTicket(REWARD_POLICY_V2)).toBe(3);
    expect(resolveJourneyCompletionTicket(REWARD_POLICY_V2, 0)).toBe(0);
    expect(resolveJourneyCompletionTicket(REWARD_POLICY_V2, 5)).toBe(5);
    expect(() => resolveJourneyCompletionTicket(REWARD_POLICY_V2, -1)).toThrowError(
      /journey/i,
    );
    expect(() => resolveJourneyCompletionTicket(REWARD_POLICY_V2, 6)).toThrowError(
      /journey/i,
    );
  });

  it("parses valid persisted policy and rejects a changed v2 contract", () => {
    expect(parseRewardPolicy(JSON.parse(JSON.stringify(REWARD_POLICY_V2)))).toEqual(
      REWARD_POLICY_V2,
    );
    expect(() =>
      parseRewardPolicy({
        ...REWARD_POLICY_V2,
        mission: { ...REWARD_POLICY_V2.mission, defaultScore: 2 },
      }),
    ).toThrowError(/reward policy/i);
  });

  it("resolves shared policy bounds by persisted version", () => {
    expect(rewardPolicyForVersion(2)).toBe(REWARD_POLICY_V2);
    expect(() => rewardPolicyForVersion(999)).toThrowError(/unknown reward policy version/i);
  });
});
