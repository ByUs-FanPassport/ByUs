import { z } from "zod";
import { ACTIVITY_SOURCE_BY_TYPE, activityTypeSchema, celebritySchema, mintFactsSchema, mintStatusLabel, passportActivityContextSchema, stampTypeLabel, stampTypeSchema, type PassportLocale } from "./passport-read-model";

export const stampDetailRecordSchema = z.object({
  id: z.uuid(), type: stampTypeSchema, businessStatus: z.literal("issued"), mint: mintFactsSchema,
  issuedAt: z.iso.datetime({ offset: true }), passport: z.object({ id: z.uuid() }).strict(),
  owner: z.object({ nickname: z.string().trim().min(2).max(16).nullable() }).strict(), celebrity: celebritySchema,
  activity: z.object({
    id: z.uuid(),
    type: activityTypeSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    points: z.number().int(),
    context: passportActivityContextSchema,
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.type !== value.activity.type) context.addIssue({ code: "custom", message: "Stamp and activity types differ" });
  if (value.activity.context.sourceType !== ACTIVITY_SOURCE_BY_TYPE[value.type]) {
    context.addIssue({ code: "custom", message: "Stamp source context does not match its type" });
  }
});

export function parseStampDetail(value: unknown, locale: PassportLocale) {
  const stamp = stampDetailRecordSchema.parse(value);
  return { ...stamp, display: { type: stampTypeLabel(locale, stamp.type), mintStatus: mintStatusLabel(locale, stamp.mint.status) }, activity: { ...stamp.activity, display: { type: stampTypeLabel(locale, stamp.activity.type) } } };
}
export type StampDetail = ReturnType<typeof parseStampDetail>;
