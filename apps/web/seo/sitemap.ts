import { APP_LOCALES } from "@/i18n/locales";
import type { MetadataRoute } from "next";
import { creatorSlugFromHomePath } from "@/features/creator/domain/creator-navigation";
import { canonicalUrl, isPrivatePath, isRehearsalPath, languageAlternates, type SeoLocale } from "./metadata";

export const STATIC_PUBLIC_PATHS = ["/", "/celebrities", "/live", "/guide", "/pages/elina-fan-guide", "/pages/us-fanmeetings", "/pages/creator-onboarding", "/pages/partners", "/pages/onchain"];

export function buildSitemap(content: readonly { path: string; locale: SeoLocale }[]): MetadataRoute.Sitemap {
  const paths = new Map<string, Set<SeoLocale>>();
  const all = [...STATIC_PUBLIC_PATHS.flatMap((path) => APP_LOCALES.map((locale) => ({ path, locale }))), ...content];
  for (const { path, locale } of all) {
    if (isPrivatePath(path) || isRehearsalPath(path)) continue;
    const creatorHome = !path.startsWith("/c/") && creatorSlugFromHomePath(path) !== null;
    if (!STATIC_PUBLIC_PATHS.includes(path) && !creatorHome && !/^\/live\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) continue;
    const locales = paths.get(path) ?? new Set<SeoLocale>();
    locales.add(locale);
    paths.set(path, locales);
  }
  return [...paths].flatMap(([path, available]) => {
    const locales = [...available].sort() as SeoLocale[];
    return locales.map((locale) => ({ url: canonicalUrl(path, locale), alternates: { languages: languageAlternates(path, locales) } }));
  });
}
