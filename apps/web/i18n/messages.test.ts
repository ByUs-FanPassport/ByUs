import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { additionalLocales, translate } from "./messages";
import { APP_LOCALES } from "./locales";
import sourceMessages from "./source-messages.json";
import { contentMessages } from "./catalogs/features__fan_posts__ui";
import { participationCopy } from "./catalogs/features__schedules__ui__participation";
import { personalCopy } from "./catalogs/features__my__ui__personal-copy";
import { accountDeletionCopy } from "./catalogs/features__profile__ui__account-deletion";

const fanWebCatalogs = new Set([
  "features__fan_posts__ui.ts", "features__schedules__ui__participation.ts",
  "features__my__ui__personal-copy.ts", "features__profile__ui__account-deletion.ts",
]);

describe("localized messages", () => {
  it("keeps fan web copy complete in every locale with matching placeholders", () => {
    const maps = [contentMessages, personalCopy, accountDeletionCopy, Object.fromEntries(APP_LOCALES.map(locale => [locale, participationCopy(locale)]))];
    const placeholders = (text: string) => (text.match(/\{(?:\d+|[A-Za-z]\w*)\}/g) ?? []).sort();
    for (const map of maps) {
      expect(Object.keys(map).sort()).toEqual([...APP_LOCALES].sort());
      const english = map.en as Record<string, string>;
      for (const locale of APP_LOCALES) {
        const copy = map[locale] as Record<string, string>;
        expect(Object.keys(copy).sort(), locale).toEqual(Object.keys(english).sort());
        for (const [key, value] of Object.entries(copy)) {
          expect(value.trim(), `${locale}/${key}`).not.toBe("");
          expect(placeholders(value), `${locale}/${key}`).toEqual(placeholders(english[key]!));
        }
      }
    }
  });
  it("reorders placeholders without interpreting values as replacement syntax or markup", () => {
    const messages = additionalLocales(() => "{1}: {0} / {0}");
    expect(translate("ja", messages, "{0}: {1}", ["$& <tag>", "名前"])).toBe("名前: $& <tag> / $& <tag>");
    expect(translate("en", messages, "{0}: {1}", ["A", "B"])).toBe("A: B");
  });

  it("includes all nine added locales and preserves every numbered and named placeholder", () => {
    const directory = resolve(process.cwd(), "i18n/catalogs");
    const sources: Record<string, { en: string }> = sourceMessages;
    const expectedLocales = APP_LOCALES.filter(locale => locale !== "ko" && locale !== "en");
    const placeholders = (text: string) => (text.match(/\{(?:\d+|[A-Za-z]\w*)\}/g) ?? []).sort();
    const seen = new Set<string>();
    for (const filename of readdirSync(directory).filter(name => name.endsWith(".ts") && !fanWebCatalogs.has(name))) {
      const file = readFileSync(resolve(directory, filename), "utf8");
      const catalog: Record<string, Record<string, string>> = JSON.parse(file.split("export const messages = ")[1].split(/ (?:as const )?satisfies /)[0]);
      for (const [key, messages] of Object.entries(catalog)) {
        expect(sources[key], `${filename}: ${key} has a source`).toBeDefined();
        expect(seen.has(key), `${key} is unique`).toBe(false);
        seen.add(key);
        expect(Object.keys(messages), key).toEqual(expectedLocales);
        for (const locale of expectedLocales) {
          expect(messages[locale].trim(), `${filename}: ${key}/${locale}`).not.toBe("");
          expect(placeholders(messages[locale]), `${key}/${locale}`).toEqual(placeholders(sources[key].en));
        }
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(sources).sort());
  });
});
