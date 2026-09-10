import { z } from "zod";
import { FAN_TIERS } from "./reward-policy";

export const FAN_STAGE_KEYS = [
  "bronze-1", "silver-1", "silver-2", "gold-1", "gold-2", "gold-3",
  "platinum-1", "platinum-2", "platinum-3", "platinum-4", "diamond-1",
] as const;
export type FanStageKey = typeof FAN_STAGE_KEYS[number];

export const fanStageSchema = z.object({
  key: z.enum(FAN_STAGE_KEYS),
  tier: z.enum(FAN_TIERS),
  subdivision: z.number().int().min(1).max(4),
  rank: z.number().int().min(1).max(11),
  minimumScore: z.number().int().nonnegative(),
}).strict().superRefine((stage, context) => {
  if (stage.key !== `${stage.tier.toLowerCase()}-${stage.subdivision}` || FAN_STAGE_KEYS[stage.rank - 1] !== stage.key) {
    context.addIssue({ code: "custom", message: "Fan stage identity is inconsistent" });
  }
});

export const fanStageProgressSchema = z.object({
  policyVersion: z.literal(2),
  current: fanStageSchema,
  next: fanStageSchema.nullable(),
  remaining: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
}).strict().superRefine((progress, context) => {
  if (progress.next
    ? progress.next.rank !== progress.current.rank + 1 || progress.next.minimumScore <= progress.current.minimumScore
    : progress.current.key !== "diamond-1" || progress.remaining !== 0 || progress.progressPercent !== 100) {
    context.addIssue({ code: "custom", message: "Fan stage progress is inconsistent" });
  }
});
export type FanStage = z.infer<typeof fanStageSchema>;
export type FanStageProgress = z.infer<typeof fanStageProgressSchema>;

const labels = { Bronze: "브론즈", Silver: "실버", Gold: "골드", Platinum: "플래티넘", Diamond: "다이아몬드" };
export function fanStageLabel(locale: "ko" | "en", stage: Pick<FanStage, "tier" | "subdivision">): string {
  const tier = locale === "ko" ? labels[stage.tier] : stage.tier;
  return stage.tier === "Bronze" || stage.tier === "Diamond" ? tier : `${tier} ${stage.subdivision}`;
}

/** An old API exposes only the attained major tier; use its entry artwork. */
export function fanTierEntryKey(tier: typeof FAN_TIERS[number]): FanStageKey {
  return `${tier.toLowerCase()}-1` as FanStageKey;
}
