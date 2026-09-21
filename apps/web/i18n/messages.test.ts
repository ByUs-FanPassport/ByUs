import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { additionalLocales, translate } from "./messages";
import { APP_LOCALES } from "./locales";
import sourceMessages from "./source-messages.json";

describe("localized messages", () => {
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
    for (const filename of readdirSync(directory).filter(name => name.endsWith(".ts"))) {
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
