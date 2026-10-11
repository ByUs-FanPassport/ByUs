import { francAll } from "franc-min";
import type { AppLocale } from "@/i18n/locales";

/** Ignore addresses/mentions: their Latin letters are not the language of the post. */
export function shouldOfferTranslation(sourceText: string, locale: AppLocale): boolean {
  const text = sourceText.normalize("NFC").replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[\p{L}\p{N}_]+/giu, "");
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  const count = (pattern: RegExp) => letters.filter(letter => pattern.test(letter)).length;
  const hangul = count(/\p{Script=Hangul}/u);
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  const han = count(/\p{Script=Han}/u);
  const thai = count(/\p{Script=Thai}/u);
  if (locale === "ko" && hangul / letters.length >= 0.7) return false;
  if (locale === "ja" && kana > 0 && (kana + han) / letters.length >= 0.7) return false;
  if (locale === "th" && thai / letters.length >= 0.7) return false;
  if (letters.length < 20 || count(/\p{Script=Latin}/u) !== letters.length) return true;
  const languages: Partial<Record<AppLocale, string>> = { en: "eng", es: "spa", id: "ind", vi: "vie", pt: "por", fr: "fra" };
  if (!languages[locale]) return true;
  const [first, second] = francAll(text);
  // Scores are relative distances, not calibrated probabilities; ambiguous text stays translatable.
  return first?.[0] !== languages[locale] || (second !== undefined && first[1] - second[1] < 0.15);
}
