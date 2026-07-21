import { z } from "zod";
import { basePassportSchema, levelLabel, mintStatusLabel, type PassportLocale } from "./passport-read-model";

export const passportCollectionRecordSchema = basePassportSchema;
export const passportCollectionSchema = z.array(passportCollectionRecordSchema);
export type PassportCollection = ReturnType<typeof parsePassportCollection>;

export function parsePassportCollection(value: unknown, locale: PassportLocale) {
  return passportCollectionSchema.parse(value).map((passport) => ({
    ...passport,
    display: { level: levelLabel(locale, passport.score.level), mintStatus: mintStatusLabel(locale, passport.mint.status) },
  }));
}

