import { REWARD_POLICY_V2, type FanTier } from "../../features/rewards/domain/reward-policy";

export const FAN_LEVEL_POLICY_VERSION = REWARD_POLICY_V2.version;
export type UpgradedFanLevel = Exclude<FanTier, "Bronze">;
export const FAN_LEVEL_THRESHOLDS: ReadonlyArray<{
  name: UpgradedFanLevel;
  score: number;
}> = REWARD_POLICY_V2.tiers.slice(1).map(
  ({ name, minimumScore }) => ({ name, score: minimumScore }),
) as ReadonlyArray<{ name: UpgradedFanLevel; score: number }>;

export type FanProgressEventType = "level_up" | "benefit_unlocked";

export type LevelUpPayload = {
  schemaVersion: 2;
  policyVersion: typeof FAN_LEVEL_POLICY_VERSION;
  celebrityId: string;
  previousScore: number;
  currentScore: number;
  previousLevel: string;
  currentLevel: UpgradedFanLevel;
};

export type BenefitUnlockedPayload = {
  schemaVersion: 2;
  policyVersion: typeof FAN_LEVEL_POLICY_VERSION;
  celebrityId: string;
  benefitId: string;
  benefitSlug: string;
  benefitPolicyVersion: number;
  previousScore: number;
  currentScore: number;
};

export function crossedFanLevels(
  previousScore: number,
  currentScore: number,
): UpgradedFanLevel[] {
  if (
    !Number.isInteger(previousScore) ||
    !Number.isInteger(currentScore) ||
    previousScore < 0 ||
    currentScore < 0
  ) {
    throw new Error("invalid fan score transition");
  }
  if (currentScore <= previousScore) return [];
  return FAN_LEVEL_THRESHOLDS.filter(
    ({ score }) => previousScore < score && currentScore >= score,
  ).map(({ name }) => name);
}

export function isFanProgressEventType(
  value: unknown,
): value is FanProgressEventType {
  return value === "level_up" || value === "benefit_unlocked";
}
