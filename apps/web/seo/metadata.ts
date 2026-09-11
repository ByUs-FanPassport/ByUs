import type { Metadata } from "next";
import { bypassImageOptimization } from "@/components/fan-ui/public-image-policy";

export type SeoLocale = "ko" | "en";
export const SITE_URL = "https://byus.kr";
export const DEFAULT_SHARE_IMAGE = `${SITE_URL}/share/default.png`;
export const NO_INDEX: Metadata["robots"] = { index: false, follow: false };

export function canonicalUrl(path: string, locale: SeoLocale): string {
  const url = new URL(path, SITE_URL);
  // Only explicitly selected language belongs in the canonical URL.
  return `${SITE_URL}${url.pathname}?locale=${locale}`;
}

export function languageAlternates(path: string, locales: readonly SeoLocale[] = ["ko", "en"]) {
  return Object.fromEntries(locales.map((locale) => [locale, canonicalUrl(path, locale)]));
}

export function isRehearsalPath(path: string): boolean {
  return /(?:^|[/-])(?:rehearsal|test|demo)(?:[/-]|$)/i.test(path);
}

export function isPrivatePath(path: string): boolean {
  return /^\/(?:admin|my|passports|stamps|settings|notifications|onboarding|login)(?:\/|$)/.test(path)
    || /^\/c\/[^/]+\/verify(?:\/|$)/.test(path)
    || /^\/live\/[^/]+\/(?:missions|survey)(?:\/|$)/.test(path);
}

/** Reuse the existing public-image allowlist/optimizer; never fetch arbitrary URLs. */
export function shareImageUrl(source?: string): string {
  if (!source || source === DEFAULT_SHARE_IMAGE) return DEFAULT_SHARE_IMAGE;
  if (!bypassImageOptimization(source) && !source.endsWith(".svg")) {
    return `${SITE_URL}/_next/image?${new URLSearchParams({ url: source, w: "1200", q: "75" })}`;
  }
  return new URL(source, SITE_URL).href;
}

export function publicMetadata(input: {
  path: string;
  locale: SeoLocale;
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
  locales?: readonly SeoLocale[];
}): Metadata {
  const { path, locale, title, description } = input;
  const url = canonicalUrl(path, locale);
  const image = shareImageUrl(input.image);
  const images = [{ url: image, alt: input.imageAlt || "ByUs | Your Bias",
    ...(image === DEFAULT_SHARE_IMAGE ? { width: 1200, height: 630 } : {}) }];
  return {
    title, description,
    alternates: { canonical: url, languages: languageAlternates(path, input.locales) },
    ...(isRehearsalPath(path) ? { robots: NO_INDEX } : {}),
    openGraph: { title, description, url, type: "website", siteName: "ByUs",
      locale: locale === "en" ? "en_US" : "ko_KR",
      alternateLocale: (input.locales ?? ["ko", "en"]).filter((value) => value !== locale).map((value) => value === "en" ? "en_US" : "ko_KR"), images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export const pageCopy = {
  home: {
    ko: { title: "ByUs | 최애의 LIVE와 팬 패스포트", description: "최애의 LIVE 일정을 확인하고 팬 인증, 예약, 출석으로 함께한 순간을 Fan Passport에 기록하세요." },
    en: { title: "ByUs | LIVE moments and your Fan Passport", description: "Discover your favorite creators and their LIVE events. Verify your fandom, reserve a spot for a LIVE, and record your attendance in your Fan Passport." },
  },
  live: {
    ko: { title: "LIVE 일정과 다시보기 | ByUs", description: "진행 중인 LIVE와 예정된 방송, 다시보기를 확인하세요. 최애의 LIVE를 예약하고 함께한 순간을 기록하세요." },
    en: { title: "LIVE events, schedules and replays | ByUs", description: "Explore ongoing LIVE events, upcoming broadcasts and replays. Reserve a spot for your favorite creator’s LIVE and record the moments you share." },
  },
  celebrities: {
    ko: { title: "셀럽과 크리에이터 | ByUs", description: "ByUs의 셀럽과 크리에이터를 만나보세요. 최애의 소식과 LIVE 일정을 확인하고 팬 패스포트를 시작하세요." },
    en: { title: "Celebrities and creators | ByUs", description: "Meet the celebrities and creators on ByUs. Explore updates and LIVE schedules, and create a Fan Passport for your favorite creator." },
  },
} as const;
