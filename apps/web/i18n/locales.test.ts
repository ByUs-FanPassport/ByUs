import { describe, expect, it } from "vitest";
import { APP_LOCALES, APP_LOCALE_NATIVE_NAMES, LANGUAGE_SELECTOR_ARIA_LABELS, isAppLocale, parseAppLocale, toContentLocale } from "./locales";

describe("app locales", () => {
  it("keeps names and accessible selector labels complete", () => {
    expect(Object.keys(APP_LOCALE_NATIVE_NAMES)).toEqual([...APP_LOCALES]);
    expect(Object.keys(LANGUAGE_SELECTOR_ARIA_LABELS)).toEqual([...APP_LOCALES]);
    expect(APP_LOCALES.every((locale) => LANGUAGE_SELECTOR_ARIA_LABELS[locale].includes(APP_LOCALE_NATIVE_NAMES[locale]))).toBe(true);
  });

  it.each([
    ["KO-kr", "ko"], ["en-US", "en"], ["ja-JP", "ja"], ["es-MX", "es"],
    ["id-ID", "id"], ["vi-VN", "vi"], ["th-TH", "th"], ["pt-BR", "pt"], ["fr-CA", "fr"],
    ["zh", "zh-Hans"], ["zh-CN", "zh-Hans"], ["zh-SG", "zh-Hans"], ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"], ["zh-MO", "zh-Hant"], ["zh-Hant-CN", "zh-Hant"], ["zh_Hans_TW", "zh-Hans"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(parseAppLocale(input)).toBe(expected);
  });

  it("uses the supplied fallback for unsupported and non-string input", () => {
    expect(parseAppLocale("de-DE", "fr")).toBe("fr");
    expect(parseAppLocale(null, "en")).toBe("en");
    expect(isAppLocale("zh-Hant")).toBe(true);
    expect(isAppLocale("zh-TW")).toBe(false);
  });

  it("keeps the content boundary on the existing ko/en contract", () => {
    expect(toContentLocale("ko")).toBe("ko");
    expect(toContentLocale("fr")).toBe("en");
  });
});
