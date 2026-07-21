import { z } from "zod";
import { activityTypeSchema, basePassportSchema, levelLabel, mintFactsSchema, mintStatusLabel, stampTypeLabel, stampTypeSchema, type PassportLocale } from "./passport-read-model";

const stampSchema = z.object({ id: z.uuid(), type: stampTypeSchema, businessStatus: z.literal("issued"), mint: mintFactsSchema, issuedAt: z.iso.datetime({ offset: true }), activityId: z.uuid() }).strict();
const activitySchema = z.object({ id: z.uuid(), type: activityTypeSchema, occurredAt: z.iso.datetime({ offset: true }), points: z.number().int(), stampId: z.uuid().nullable() }).strict();
export const passportDetailRecordSchema = basePassportSchema.extend({ stamps: z.array(stampSchema), activities: z.array(activitySchema) }).strict();

export function parsePassportDetail(value: unknown, locale: PassportLocale) {
  const passport = passportDetailRecordSchema.parse(value);
  return {
    ...passport,
    display: { level: levelLabel(locale, passport.score.level), mintStatus: mintStatusLabel(locale, passport.mint.status) },
    stamps: passport.stamps.map((stamp) => ({ ...stamp, display: { type: stampTypeLabel(locale, stamp.type), mintStatus: mintStatusLabel(locale, stamp.mint.status) } })),
    activities: passport.activities.map((activity) => ({ ...activity, display: { type: stampTypeLabel(locale, activity.type) } })),
  };
}
export type PassportDetail = ReturnType<typeof parsePassportDetail>;
