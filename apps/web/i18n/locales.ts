export const APP_LOCALES = ["ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "id", "vi", "th", "pt", "fr"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const APP_LOCALE_NATIVE_NAMES: Record<AppLocale, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  es: "Español",
  id: "Bahasa Indonesia",
  vi: "Tiếng Việt",
  th: "ไทย",
  pt: "Português",
  fr: "Français",
};

export const LANGUAGE_SELECTOR_ARIA_LABELS: Record<AppLocale, string> = {
  ko: "언어 선택, 현재 한국어",
  en: "Choose language, currently English",
  ja: "言語を選択、現在は日本語",
  "zh-Hans": "选择语言，当前为简体中文",
  "zh-Hant": "選擇語言，目前為繁體中文",
  es: "Elegir idioma, actualmente Español",
  id: "Pilih bahasa, saat ini Bahasa Indonesia",
  vi: "Chọn ngôn ngữ, hiện tại là Tiếng Việt",
  th: "เลือกภาษา ภาษาปัจจุบันคือไทย",
  pt: "Escolher idioma, atualmente Português",
  fr: "Choisir la langue, actuellement Français",
};

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

/** Generic zh defaults to Simplified Chinese; script subtags take precedence over region. */
export function parseAppLocale(value: unknown, fallback: AppLocale = "ko"): AppLocale {
  if (typeof value !== "string") return fallback;
  const parts = value.trim().replaceAll("_", "-").split("-").filter(Boolean);
  const language = parts[0]?.toLowerCase();
  if (!language) return fallback;

  if (language === "zh") {
    const subtags = parts.slice(1).map((part) => part.toLowerCase());
    if (subtags.includes("hant")) return "zh-Hant";
    if (subtags.includes("hans")) return "zh-Hans";
    return subtags.some((part) => part === "tw" || part === "hk" || part === "mo") ? "zh-Hant" : "zh-Hans";
  }

  return APP_LOCALES.find((locale) => locale.toLowerCase() === language) ?? fallback;
}

export function toContentLocale(locale: AppLocale): "ko" | "en" {
  return locale === "ko" ? "ko" : "en";
}
