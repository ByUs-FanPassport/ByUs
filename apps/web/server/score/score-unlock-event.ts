export const FAN_LEVEL_THRESHOLDS = [
  { name: "Silver", score: 5 },
  { name: "Gold", score: 10 },
  { name: "Platinum", score: 20 },
  { name: "Diamond", score: 35 },
] as const;

export type UpgradedFanLevel = (typeof FAN_LEVEL_THRESHOLDS)[number]["name"];
export type FanProgressEventType = "level_up" | "benefit_unlocked";

export type LevelUpPayload = {
  schemaVersion: 1;
  celebrityId: string;
  previousScore: number;
  currentScore: number;
  previousLevel: string;
  currentLevel: UpgradedFanLevel;
};

export type BenefitUnlockedPayload = {
  schemaVersion: 1;
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
