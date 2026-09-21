import { type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__domain__creator-news";
import { translate } from "@/i18n/messages";
import { z } from "zod";
import type { ChzzkPost } from "./chzzk-posts";

export const newsNoticesSchema = z.object({ notices: z.array(z.object({
  slug: z.string(), title: z.string(), pinned: z.boolean(),
  kind: z.enum(["standard", "welcome"]).default("standard"), publishedAt: z.string(),
})), nextCursor: z.string().nullable().default(null) });
export type NewsNotice = z.infer<typeof newsNoticesSchema>["notices"][number];
export type CreatorNewsItem =
  | { source: "byus"; key: string; title: string; date: string; pinned: boolean; notice: NewsNotice }
  | { source: "chzzk"; key: string; title: string; date: string; pinned: false; post: ChzzkPost };

export function chzzkPostTitle(post: ChzzkPost, locale: AppLocale): string {
  return post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 160)
    || (locale === "ko" ? "사진 소식" : translate(locale, localizedMessages.m26082a2169cd, "Photo update"));
}

export function creatorNewsItems(notices: NewsNotice[], posts: ChzzkPost[], locale: AppLocale, full: boolean): CreatorNewsItem[] {
  const items: CreatorNewsItem[] = [
    ...notices.map((notice): CreatorNewsItem => ({ source: "byus", key: `byus:${notice.slug}`, title: notice.title, date: notice.publishedAt, pinned: notice.pinned, notice })),
    ...posts.map((post): CreatorNewsItem => ({ source: "chzzk", key: `chzzk:${post.id}`, title: chzzkPostTitle(post, locale), date: post.date, pinned: false, post })),
  ];
  const newest = (a: CreatorNewsItem, b: CreatorNewsItem) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)) || b.key.localeCompare(a.key);
  const pinned = items.filter((item) => item.pinned).sort((a, b) => {
    const aWelcome = a.source === "byus" && a.notice.kind === "welcome";
    const bWelcome = b.source === "byus" && b.notice.kind === "welcome";
    return Number(aWelcome) - Number(bWelcome) || newest(a, b);
  });
  if (full) return [...pinned, ...items.filter((item) => !item.pinned).sort(newest)];
  const first = pinned[0];
  return [...(first ? [first] : []), ...items.filter((item) => item.key !== first?.key).sort(newest)].slice(0, 3);
}
