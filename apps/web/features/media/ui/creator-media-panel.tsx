"use client";
import Image from "next/image";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { ContentAssetImage } from "@/features/content-safety/ui/content-asset";
import { officialMediaPageSchema } from "../domain/official-media";
import type { ContentAsset } from "@/features/fan-posts/domain/content";
import { z } from "zod";
import { FanAction } from "@/components/fan-ui/fan-action";
import { instagramMediaSchema } from "@/server/instagram/model";
import { liveEventResponseSchema } from "@/features/live/domain/live-event";
import { isRecordedReplayUrl } from "@/features/live/domain/live-watch-link";
import { chzzkFeedSchema, CHZZK_CREATOR_SLUG, CHZZK_CHANNEL_ID } from "@/features/fanpage/domain/chzzk-posts";
import { useNewsSource } from "@/features/fanpage/ui/use-news-source";
import { ParticipationState } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/schedules/ui/participation.module.css";

type Media = { id: string; kind: "photos" | "videos" | "replays"; title: string; image: string | null; asset?: ContentAsset | null; href: string; date: string; slug?: string };
const key = (item: Media) => item.id;
const parseOfficial = (value: unknown) => officialMediaPageSchema.parse(value);
const parseInstagram = (value: unknown) => ({ items: z.object({ items: z.array(instagramMediaSchema) }).parse(value).items.map((item): Media => ({ id: `instagram:${item.id}`, kind: item.mediaType === "VIDEO" ? "videos" : "photos", title: item.caption || `@${item.sourceAccount.username}`, image: item.imageUrl, href: item.permalink, date: item.timestamp })), nextCursor: null });
const parseChzzk = (value: unknown) => { const page = chzzkFeedSchema.parse(value); return { items: page.items.flatMap(item => item.images.map((image, index): Media => ({ id: `chzzk:${item.id}:${index}`, kind: "photos", title: item.text, image: image.url, href: `/community/post/${item.id}`, date: item.date }))), nextCursor: page.nextCursor }; };
const parseReplay = (value: unknown) => ({ items: z.object({ catalog: z.object({ replay: z.array(liveEventResponseSchema) }) }).parse(value).catalog.replay.filter(({ live }) => live.watch.available && live.watch.mode === "replay" && isRecordedReplayUrl(live.watch.provider, live.watch.url)).map(({ live }): Media => ({ id: `replay:${live.id}`, kind: "replays", title: live.title, image: live.heroImage.url, href: live.watch.url, date: live.endsAt ?? live.startsAt, slug: live.celebrity.slug })), nextCursor: null });

export function CreatorMediaPanel({ slug, locale, channelId = slug === CHZZK_CREATOR_SLUG ? CHZZK_CHANNEL_ID : null }: { slug: string; locale: AppLocale; channelId?: string | null }) {
  const c = participationCopy(locale), router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const requestedFilter = search.get("media");
  const filter = requestedFilter === "photos" || requestedFilter === "videos" || requestedFilter === "replays" ? requestedFilter : "all";
  function setFilter(value: "all" | Media["kind"]) {
    const query = new URLSearchParams(search.toString());
    if (value === "all") query.delete("media"); else query.set("media", value);
    router.replace(`${pathname}?${query.toString()}` as Route, { scroll: false });
  }
  const auth = usePrivy(), session = useByUsSession();
  const official = useNewsSource(`/api/celebrities/${encodeURIComponent(slug)}/media?locale=${toContentLocale(locale)}`, parseOfficial, key, { key: `${auth.ready}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}`, ready: auth.ready && session.ready, getToken: async () => { if (!auth.authenticated) return null; const token = await auth.getAccessToken(); if (!token) throw Error(); return token; } });
  const instagram = useNewsSource(`/api/celebrities/${encodeURIComponent(slug)}/instagram`, parseInstagram, key);
  const chzzk = useNewsSource(channelId ? `/api/celebrities/${encodeURIComponent(slug)}/chzzk` : null, parseChzzk, key);
  const replay = useNewsSource(`/api/live-events?locale=${toContentLocale(locale)}`, parseReplay, key);
  const sources = [
    ...(filter !== "replays" ? [{ name: "ByUs", resource: official }, { name: "Instagram", resource: instagram }] : []),
    ...(channelId && (filter === "all" || filter === "photos") ? [{ name: "CHZZK", resource: chzzk }] : []),
    ...(filter === "all" || filter === "replays" ? [{ name: c.replays, resource: replay }] : []),
  ];
  const items: Media[] = [...official.state.data, ...instagram.state.data, ...chzzk.state.data.map(item => ({ ...item, href: `https://chzzk.naver.com/${channelId}/community` })), ...replay.state.data.filter(item => item.slug === slug)]
    .filter(item => filter === "all" || item.kind === filter).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
  return <section className={styles.panel} aria-label={`${c.photos} · ${c.videos}`}>
    <div className={styles.tabs}>{(["all", "photos", "videos", "replays"] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{c[value]}</button>)}</div>
    {sources.map(({ name, resource }) => resource.state.status !== "ready" && <div key={name}><strong>{name}</strong><ParticipationState locale={locale} status={resource.state.status} retry={resource.retry} /></div>)}
    {!items.length && sources.every(source => source.resource.state.status === "ready") && <p className={styles.feedback}>{c.empty}</p>}
    <ul className={styles.media}>{items.map(item => <li key={item.id}><a href={item.href.startsWith("/") ? `${item.href}?locale=${locale}` : item.href} target={item.href.startsWith("/") ? undefined : "_blank"} rel={item.href.startsWith("/") ? undefined : "noopener noreferrer"}>{item.asset ? <ContentAssetImage asset={item.asset} locale={locale} alt="" /> : item.image ? <Image src={item.image} width={640} height={480} alt="" unoptimized referrerPolicy="no-referrer" /> : <span className={styles.videoLink} aria-hidden="true">▶</span>}<strong>{item.title.slice(0, 120) || c[item.kind]}</strong><span>{c[item.kind]} · <time dateTime={item.date}>{new Date(item.date).toLocaleDateString(locale)}</time></span></a></li>)}</ul>
    {filter !== "replays" && official.state.nextCursor && <FanAction onClick={official.loadMore} disabled={official.state.moreLoading}>ByUs · {official.state.moreLoading ? c.loading : c.more}</FanAction>}
    {filter !== "replays" && official.state.moreError && <ParticipationState locale={locale} status="error" retry={official.loadMore} />}
    {(filter === "all" || filter === "photos") && chzzk.state.nextCursor && <FanAction onClick={chzzk.loadMore} disabled={chzzk.state.moreLoading}>CHZZK · {chzzk.state.moreLoading ? c.loading : c.more}</FanAction>}
    {(filter === "all" || filter === "photos") && chzzk.state.moreError && <ParticipationState locale={locale} status="error" retry={chzzk.loadMore} />}
  </section>;
}
