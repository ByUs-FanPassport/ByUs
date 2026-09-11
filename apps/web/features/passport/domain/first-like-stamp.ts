import { z } from "zod";
import { mintStatusSchema, stampTypeLabel, type PassportLocale, type PassportStampType } from "./passport-read-model";

export const firstReactionStampSchema = z.object({
  reactionId: z.uuid(),
  stampId: z.uuid(),
  activityId: z.uuid(),
  reactionType: z.literal("FirstReaction"),
  mintStatus: mintStatusSchema,
  txHash: z.string().nullable(),
  issuedAt: z.iso.datetime({ offset: true }),
}).strict();

export type FirstReactionStamp = z.infer<typeof firstReactionStampSchema>;

// First Like is a display-only stamp backed by the existing Reaction. It is
// deliberately excluded from reward/eligibility stamp and activity enums.
export type PassportDisplayStampType = PassportStampType | "first_reaction";
export interface PassportDisplayStamp {
  id?: string;
  type: PassportDisplayStampType;
  issuedAt: string;
  points?: number;
}

export function displayStampLabel(locale: PassportLocale, type: PassportDisplayStampType): string {
  return type === "first_reaction"
    ? locale === "ko" ? "첫 좋아요" : "First Like"
    : stampTypeLabel(locale, type);
}

export function displayStampCount(activityStampCount: number, firstLikeRecorded: boolean): number {
  return activityStampCount + (firstLikeRecorded ? 1 : 0);
}

export function passportStampDisplay(input: {
  stamps: readonly PassportDisplayStamp[];
  stampSummary: { total: number };
  firstReaction?: FirstReactionStamp | null;
}) {
  const stamps = input.stamps.filter((stamp) => stamp.type !== "first_reaction");
  if (input.firstReaction) {
    stamps.push({
      id: input.firstReaction.stampId,
      type: "first_reaction",
      issuedAt: input.firstReaction.issuedAt,
    });
  }
  return {
    stamps,
    totalCount: displayStampCount(input.stampSummary.total, Boolean(input.firstReaction)),
  };
}

export function boundFirstLikeCount(creators: readonly {
  passport: { id: string } | null;
  firstReaction: unknown | null;
}[]): number {
  return new Set(creators.flatMap((creator) => creator.passport && creator.firstReaction ? [creator.passport.id] : [])).size;
}
