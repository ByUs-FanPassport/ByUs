import type { Route } from "next";
import type { AppLocale } from "@/i18n/locales";

export const COMMUNITY_TABS = ["posts", "fans", "certifications", "requests"] as const;
export type CommunityTab = typeof COMMUNITY_TABS[number];

export function parseCommunityTab(value: unknown): CommunityTab {
  return COMMUNITY_TABS.includes(value as CommunityTab) ? value as CommunityTab : "posts";
}

export function communityHref(slug: string, locale: AppLocale, tab: CommunityTab = "posts"): Route {
  return `/community?${new URLSearchParams({ creator: slug, tab, locale })}` as Route;
}

/** An explicit unpublished creator must never silently select somebody else. */
export function selectCommunityCreator<T extends { slug: string; displayOrder: number }>(creators: readonly T[], requested?: string): T | undefined {
  if (requested !== undefined) return creators.find(creator => creator.slug === requested);
  return [...creators].sort((a, b) => a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug))[0];
}
