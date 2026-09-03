import { z } from "zod";
import { ACTIVITY_SOURCE_BY_TYPE, activityTypeSchema, basePassportSchema, levelLabel, mintFactsSchema, mintStatusLabel, mintStatusSchema, passportActivityContextSchema, stampTypeLabel, stampTypeSchema, type PassportLocale } from "./passport-read-model";

const stampSchema = z.object({
  id: z.uuid(),
  type: stampTypeSchema,
  businessStatus: z.literal("issued"),
  mint: mintFactsSchema,
  issuedAt: z.iso.datetime({ offset: true }),
  activityId: z.uuid(),
  context: passportActivityContextSchema,
}).strict();
const activitySchema = z.object({
  id: z.uuid(),
  type: activityTypeSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  points: z.number().int(),
  stampId: z.uuid().nullable(),
  context: passportActivityContextSchema,
}).strict();
export const passportDetailRecordSchema = basePassportSchema.extend({
  stamps: z.array(stampSchema),
  activities: z.array(activitySchema),
  nextBenefit: z.unknown(),
  firstReaction: z.object({
    reactionId: z.uuid(), stampId: z.uuid(), activityId: z.uuid(),
    reactionType: z.literal("FirstReaction"), mintStatus: mintStatusSchema,
    txHash: z.string().nullable(), issuedAt: z.iso.datetime({ offset: true }),
  }).strict().nullable().optional().default(null),
}).strict().superRefine((passport, context) => {
  for (const stamp of passport.stamps) {
    if (stamp.context.sourceType !== ACTIVITY_SOURCE_BY_TYPE[stamp.type]) {
      context.addIssue({ code: "custom", message: "Stamp source context does not match its type" });
    }
  }
  for (const activity of passport.activities) {
    if (activity.context.sourceType !== ACTIVITY_SOURCE_BY_TYPE[activity.type]) {
      context.addIssue({ code: "custom", message: "Activity source context does not match its type" });
    }
  }
});

export function parsePassportDetailRecord(value: unknown, locale: PassportLocale) {
  const passport = passportDetailRecordSchema.parse(value);
  const nextBenefit = nextPassportBenefitSchema.nullable().parse(passport.nextBenefit);
  return {
    ...passport,
    nextBenefit,
    display: { level: levelLabel(locale, passport.score.level), mintStatus: mintStatusLabel(locale, passport.mint.status) },
    stamps: passport.stamps.map((stamp) => ({ ...stamp, display: { type: stampTypeLabel(locale, stamp.type), mintStatus: mintStatusLabel(locale, stamp.mint.status) } })),
    activities: passport.activities.map((activity) => ({ ...activity, display: { type: stampTypeLabel(locale, activity.type) } })),
  };
}

export const passportProgressSchema = z.object({
  currentScore: z.number().int().nonnegative(),
  currentLevel: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]),
  nextLevel: z.enum(["Silver", "Gold", "Platinum", "Diamond"]).nullable(),
  nextThreshold: z.number().int().positive().nullable(),
  remainingPoints: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  maxed: z.boolean(),
}).strict();

const missingBenefitConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("score"), current: z.number().int().nonnegative(), required: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("level"), current: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]), required: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]) }).strict(),
  z.object({ type: z.literal("stamp"), required: stampTypeSchema }).strict(),
  z.object({ type: z.literal("activity"), required: activityTypeSchema }).strict(),
  z.object({ type: z.literal("opens_at"), at: z.iso.datetime({ offset: true }) }).strict(),
]);

export const nextPassportBenefitSchema = z.object({
  id: z.uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(160),
  state: z.enum(["locked", "eligible"]),
  allocationMode: z.enum(["direct_claim", "application_selection"]),
  applicationStatus: z.enum(["submitted", "selected", "not_selected"]).nullable(),
  eligibilityLabel: z.string().trim().min(1).max(300),
  minimumScore: z.number().int().nonnegative(),
  minimumLevel: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]),
  requiredStampType: stampTypeSchema.nullable(),
  requiredActivityType: activityTypeSchema.nullable(),
  missingConditions: z.array(missingBenefitConditionSchema),
}).strict();

export type PassportDetailRecord = ReturnType<typeof parsePassportDetailRecord>;
export type PassportProgress = z.infer<typeof passportProgressSchema>;
export type NextPassportBenefit = z.infer<typeof nextPassportBenefitSchema>;
export type PassportDetail = PassportDetailRecord & {
  progress: PassportProgress;
};
