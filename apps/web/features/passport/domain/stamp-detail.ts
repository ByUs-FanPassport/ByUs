import { z } from "zod";
import { activityTypeSchema, celebritySchema, mintFactsSchema, mintStatusLabel, stampTypeLabel, stampTypeSchema, type PassportLocale } from "./passport-read-model";

export const stampDetailRecordSchema = z.object({
  id: z.uuid(), type: stampTypeSchema, businessStatus: z.literal("issued"), mint: mintFactsSchema,
  issuedAt: z.iso.datetime({ offset: true }), passport: z.object({ id: z.uuid() }).strict(),
  owner: z.object({ nickname: z.null() }).strict(), celebrity: celebritySchema,
  activity: z.object({ id: z.uuid(), type: activityTypeSchema, occurredAt: z.iso.datetime({ offset: true }), points: z.number().int() }).strict(),
}).strict().superRefine((value, context) => {
  if (value.type !== value.activity.type) context.addIssue({ code: "custom", message: "Stamp and activity types differ" });
});

export function parseStampDetail(value: unknown, locale: PassportLocale) {
  const stamp = stampDetailRecordSchema.parse(value);
  return { ...stamp, display: { type: stampTypeLabel(locale, stamp.type), mintStatus: mintStatusLabel(locale, stamp.mint.status) }, activity: { ...stamp.activity, display: { type: stampTypeLabel(locale, stamp.activity.type) } } };
}
export type StampDetail = ReturnType<typeof parseStampDetail>;
