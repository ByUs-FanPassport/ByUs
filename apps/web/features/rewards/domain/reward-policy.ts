export const FAN_TIERS = [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
] as const;

export type FanTier = (typeof FAN_TIERS)[number];

export function tierRank(tier: FanTier): number {
  return FAN_TIERS.indexOf(tier);
}

export interface RewardPolicy {
  readonly version: number;
  readonly tiers: readonly {
    readonly name: FanTier;
    readonly minimumScore: number;
  }[];
  readonly mission: {
    readonly minimumScore: number;
    readonly maximumScore: number;
    readonly defaultScore: number;
    readonly minimumTicket: number;
    readonly maximumTicket: number;
    readonly defaultTicket: number;
  };
  readonly journey: {
    readonly minimumCompletionTicket: number;
    readonly maximumCompletionTicket: number;
    readonly defaultCompletionTicket: number;
  };
}

export const REWARD_POLICY_V1 = {
  version: 1,
  tiers: [
    { name: "Bronze", minimumScore: 0 },
    { name: "Silver", minimumScore: 5 },
    { name: "Gold", minimumScore: 10 },
    { name: "Platinum", minimumScore: 20 },
    { name: "Diamond", minimumScore: 35 },
  ],
  mission: {
    minimumScore: 0,
    maximumScore: 2,
    defaultScore: 2,
    minimumTicket: 0,
    maximumTicket: 0,
    defaultTicket: 0,
  },
  journey: {
    minimumCompletionTicket: 0,
    maximumCompletionTicket: 0,
    defaultCompletionTicket: 0,
  },
} as const satisfies RewardPolicy;

export const REWARD_POLICY_V2 = {
  version: 2,
  tiers: [
    { name: "Bronze", minimumScore: 0 },
    { name: "Silver", minimumScore: 15 },
    { name: "Gold", minimumScore: 50 },
    { name: "Platinum", minimumScore: 120 },
    { name: "Diamond", minimumScore: 250 },
  ],
  mission: {
    minimumScore: 0,
    maximumScore: 3,
    defaultScore: 1,
    minimumTicket: 0,
    maximumTicket: 2,
    defaultTicket: 1,
  },
  journey: {
    minimumCompletionTicket: 0,
    maximumCompletionTicket: 5,
    defaultCompletionTicket: 3,
  },
} as const satisfies RewardPolicy;

export const REWARD_POLICIES = [REWARD_POLICY_V1, REWARD_POLICY_V2] as const;

export function rewardPolicyForVersion(version: number): RewardPolicy {
  const policy = REWARD_POLICIES.find((candidate) => candidate.version === version);
  if (!policy) throw new Error(`Unknown reward policy version: ${version}`);
  return policy;
}

function isIntegerInRange(value: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function tierForScore(policy: RewardPolicy, score: number): FanTier {
  if (!Number.isSafeInteger(score) || score < 0) {
    throw new Error("Fan score must be a nonnegative safe integer");
  }

  let tier: FanTier = "Bronze";
  for (const milestone of policy.tiers) {
    if (score < milestone.minimumScore) break;
    tier = milestone.name;
  }
  return tier;
}

export function resolveMissionReward(
  policy: RewardPolicy,
  input: { readonly score?: number; readonly ticket?: number },
) {
  const score = input.score ?? policy.mission.defaultScore;
  const ticket = input.ticket ?? policy.mission.defaultTicket;
  if (
    !isIntegerInRange(
      score,
      policy.mission.minimumScore,
      policy.mission.maximumScore,
    )
  ) {
    throw new Error("Mission score is outside the active reward policy");
  }
  if (
    !isIntegerInRange(
      ticket,
      policy.mission.minimumTicket,
      policy.mission.maximumTicket,
    )
  ) {
    throw new Error("Mission ticket is outside the active reward policy");
  }
  return { score, ticket };
}

export function resolveJourneyCompletionTicket(
  policy: RewardPolicy,
  ticket = policy.journey.defaultCompletionTicket,
) {
  if (
    !isIntegerInRange(
      ticket,
      policy.journey.minimumCompletionTicket,
      policy.journey.maximumCompletionTicket,
    )
  ) {
    throw new Error("Journey completion ticket is outside the active reward policy");
  }
  return ticket;
}

export function parseRewardPolicy(value: unknown): RewardPolicy {
  for (const policy of REWARD_POLICIES) {
    if (JSON.stringify(value) === JSON.stringify(policy)) return policy;
  }
  throw new Error("Unknown or invalid reward policy contract");
}
