import "server-only";
import { z } from "zod";
import { isAppLocale, type AppLocale } from "@/i18n/locales";

export class GoogleTranslationError extends Error {
  constructor(readonly code: "TRANSLATION_UNAVAILABLE" | "TRANSLATION_RATE_LIMITED" | "TRANSLATION_FAILED" | "TRANSLATION_INVALID_INPUT") {
    super(code);
    this.name = "GoogleTranslationError";
  }
}

const translationSchema = z.object({ data: z.object({ translations: z.array(z.object({
  translatedText: z.string().min(1).max(100_000),
  detectedSourceLanguage: z.string().min(2).max(32).optional(),
})).length(1) }) });

function plainText(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : match;
  });
}

// Google v2 supports API keys in headers; never put credentials in logged URLs.
// https://docs.cloud.google.com/docs/authentication/api-keys-use
export async function translateText(text: string, targetLocale: AppLocale): Promise<{
  translatedText: string; detectedSourceLocale?: string;
}> {
  if (typeof text !== "string" || !text.trim() || Array.from(text).length > 20_000 || !isAppLocale(targetLocale)) {
    throw new GoogleTranslationError("TRANSLATION_INVALID_INPUT");
  }
  const key = process.env.GOOGLE_TRANSLATION_API_KEY?.trim();
  if (!key) throw new GoogleTranslationError("TRANSLATION_UNAVAILABLE");
  const target = targetLocale === "zh-Hans" ? "zh-CN" : targetLocale === "zh-Hant" ? "zh-TW" : targetLocale;
  try {
    const response = await fetch("https://translation.googleapis.com/language/translate/v2", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({ q: text, target, format: "text", model: "nmt" }),
    });
    if (response.status === 429) throw new GoogleTranslationError("TRANSLATION_RATE_LIMITED");
    if (response.status === 401 || response.status === 403) throw new GoogleTranslationError("TRANSLATION_UNAVAILABLE");
    if (!response.ok || !response.body) throw new GoogleTranslationError("TRANSLATION_FAILED");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) {
          await reader.cancel();
          throw new GoogleTranslationError("TRANSLATION_FAILED");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const parsed = translationSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = parsed.data.translations[0];
    return { translatedText: plainText(result.translatedText),
      ...(result.detectedSourceLanguage ? { detectedSourceLocale: result.detectedSourceLanguage } : {}) };
  } catch (error) {
    if (error instanceof GoogleTranslationError) throw error;
    // Provider errors can echo text or credentials. Expose only our fixed code.
    throw new GoogleTranslationError("TRANSLATION_FAILED");
  }
}
