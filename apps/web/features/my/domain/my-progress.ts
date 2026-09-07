import { z } from "zod";
import { nextPassportBenefitSchema } from "../../passport/domain/passport-detail";
import { FAN_TIERS, tierRank } from "../../rewards/domain/reward-policy";
import type { MySummary } from "./my-summary";

export type MyCreator = MySummary["creators"][number];
export type PassportCreator = MyCreator & { passport: NonNullable<MyCreator["passport"]> };

/** A creator's attained tier remains authoritative; never infer it from score. */
export function rankedPassportCreators(creators: readonly MyCreator[]): PassportCreator[] {
  return creators.filter((creator): creator is PassportCreator => creator.passport !== null)
    .toSorted((a, b) => tierRank(b.passport.tier) - tierRank(a.passport.tier)
      || b.passport.score - a.passport.score
      || (a.celebrity.slug < b.celebrity.slug ? -1 : a.celebrity.slug > b.celebrity.slug ? 1 : 0));
}

// Read only the MY projection from the existing, owner-authorized detail response.
export const myBenefitPassportSchema = z.object({
  passport: z.object({
    id: z.uuid(),
    celebrity: z.object({ slug: z.string(), name: z.string() }),
    score: z.object({ points: z.number().int().nonnegative(), level: z.enum(FAN_TIERS) }),
    nextBenefit: nextPassportBenefitSchema.nullable(),
  }),
});

export function benefitScorePercent(score: number, minimumScore: number): number | null {
  return minimumScore > 0 ? Math.min(100, Math.max(0, Math.round(score / minimumScore * 100))) : null;
}
