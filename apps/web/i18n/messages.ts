import type { AppLocale } from "./locales";

export type TranslationLocale = Exclude<AppLocale, "ko" | "en">;
export type TranslatedMessage = Readonly<Record<TranslationLocale, string>>;

/** Build real, typed records while keeping each screen's messages in its own bundle. */
export function additionalLocales<T>(create: (locale: TranslationLocale) => T) {
  return {
    ja: create("ja"),
    "zh-Hans": create("zh-Hans"),
    "zh-Hant": create("zh-Hant"),
    es: create("es"),
    id: create("id"),
    vi: create("vi"),
    th: create("th"),
    pt: create("pt"),
    fr: create("fr"),
  };
}

/** These catalogs use numbered placeholders, not ICU expressions. */
export function translate(
  locale: AppLocale,
  translations: TranslatedMessage,
  english: string,
  values: readonly unknown[] = [],
): string {
  const message = locale === "ko" || locale === "en" ? english : translations[locale];
  return message.replace(/\{(\d+)\}/g, (token, index: string) => {
    const position = Number(index);
    return position < values.length ? String(values[position]) : token;
  });
}
