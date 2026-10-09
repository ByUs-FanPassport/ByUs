import type { Route } from "next";
import type { AppLocale } from "@/i18n/locales";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

export const FAN_PAGE_TABS = ["home", "board", "certifications", "events", "leaderboard"] as const;
export type FanPageTab = typeof FAN_PAGE_TABS[number];
export type BoardSection = "feed" | "media" | "live";
export type BoardFeedSource = "all" | "official" | "fans";
export type BoardNewsFilter = "all" | "artist_post" | "notice" | "chzzk";

export function parseFanPageTab(value: unknown): FanPageTab {
  if (value === "community" || value === "notice" || value === "media" || value === "live") return "board";
  if (value === "raffles" || value === "benefits") return "events";
  return FAN_PAGE_TABS.includes(value as FanPageTab) ? value as FanPageTab : "home";
}

export function resolveBoardSection(tab: unknown, section: unknown): BoardSection {
  if (tab === "media" || tab === "live") return tab;
  return section === "media" || section === "live" ? section : "feed";
}

export function resolveBoardSource(tab: unknown, source: unknown): BoardFeedSource {
  if (tab === "community") return "fans";
  if (tab === "notice") return "official";
  return source === "official" || source === "fans" ? source : "all";
}

export function fanPageHref(slug: string, locale: AppLocale, tab: FanPageTab): Route {
  const query = new URLSearchParams({ tab, locale });
  return `${creatorHomeHref(slug)}?${query}#celebrity-content` as Route;
}

export function boardHref(slug: string, locale: AppLocale, options: {
  section?: BoardSection;
  source?: BoardFeedSource;
  newsFilter?: BoardNewsFilter;
  mediaFilter?: "photos" | "videos" | "replays";
} = {}): Route {
  const query = new URLSearchParams({ tab: "board" });
  if (options.section && options.section !== "feed") query.set("section", options.section);
  if ((!options.section || options.section === "feed") && options.source && options.source !== "all") query.set("source", options.source);
  query.set("locale", locale);
  if (options.newsFilter && options.newsFilter !== "all") query.set("news", options.newsFilter);
  if (options.section === "media" && options.mediaFilter) query.set("media", options.mediaFilter);
  return `${creatorHomeHref(slug)}?${query}#celebrity-content` as Route;
}
