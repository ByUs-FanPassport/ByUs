import { z } from "zod";
import { basePassportSchema, levelLabel, mintStatusLabel, type PassportLocale } from "./passport-read-model";

export const passportCollectionRecordSchema = basePassportSchema;
export const passportCollectionSchema = z.array(passportCollectionRecordSchema);
export type PassportCollection = ReturnType<typeof parsePassportCollection>;
const passportCollectionDisplaySchema = z.object({
  level: z.string().trim().min(1).max(80),
  mintStatus: z.string().trim().min(1).max(120),
}).strict();
export const passportCollectionResponseSchema = z.object({
  passports: z.array(basePassportSchema.extend({
    display: passportCollectionDisplaySchema,
  }).strict()),
}).strict();
export type PassportCollectionResponse = z.infer<typeof passportCollectionResponseSchema>;

export function parsePassportCollection(value: unknown, locale: PassportLocale) {
  return passportCollectionSchema.parse(value).map((passport) => ({
    ...passport,
    display: { level: levelLabel(locale, passport.score.level), mintStatus: mintStatusLabel(locale, passport.mint.status) },
  }));
}

export function parsePassportCollectionResponse(value: unknown): PassportCollectionResponse {
  return passportCollectionResponseSchema.parse(value);
}
