"use client";
import { ArrowUpRight } from "lucide-react";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import type { PublishedCelebrity } from "@/server/content/content-domain";
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
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { chzzkFeedSchema, CHZZK_CREATOR_SLUG, CHZZK_CHANNEL_ID } from "@/features/fanpage/domain/chzzk-posts";
import { useNewsSource } from "@/features/fanpage/ui/use-news-source";
import { ParticipationState } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/schedules/ui/participation.module.css";
import mediaStyles from "./creator-media-panel.module.css";

type Media = { id: string; kind: "photos" | "videos" | "replays"; title: string; image: string | null; asset?: ContentAsset | null; href: string; date: string; slug?: string; source?: string };
const key = (item: Media) => item.id;
const parseOfficial = (value: unknown) => officialMediaPageSchema.parse(value);
const parseInstagram = (value: unknown) => ({ items: z.object({ items: z.array(instagramMediaSchema) }).parse(value).items.map((item): Media => ({ id: `instagram:${item.id}`, kind: item.mediaType === "VIDEO" ? "videos" : "photos", title: item.caption || `@${item.sourceAccount.username}`, image: item.imageUrl, href: item.permalink, date: item.timestamp })), nextCursor: null });
const parseChzzk = (value: unknown) => { const page = chzzkFeedSchema.parse(value); return { items: page.items.flatMap(item => item.images.map((image, index): Media => ({ id: `chzzk:${item.id}:${index}`, kind: "photos", title: item.text, image: image.url, href: `/community/post/${item.id}`, date: item.date }))), nextCursor: page.nextCursor }; };
const parseReplay = (value: unknown) => ({ items: z.object({ catalog: z.object({ replay: z.array(liveEventResponseSchema) }) }).parse(value).catalog.replay.filter(({ live }) => live.watch.available && live.watch.mode === "replay" && isRecordedReplayUrl(live.watch.provider, live.watch.url)).map(({ live }): Media => ({ id: `replay:${live.id}`, kind: "replays", title: live.title, image: live.heroImage.url, href: live.watch.url, date: live.endsAt ?? live.startsAt, slug: live.celebrity.slug })), nextCursor: null });

export function CreatorMediaPanel({ slug, locale, channelId = slug === CHZZK_CREATOR_SLUG ? CHZZK_CHANNEL_ID : null, socialLinks = [] }: { slug: string; locale: AppLocale; channelId?: string | null; socialLinks?: PublishedCelebrity["socialLinks"] }) {
  const c = participationCopy(locale), discovery = discoveryCopy(locale), router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const requestedFilter = search.get("media");
  const filter = requestedFilter === "photos" || requestedFilter === "videos" || requestedFilter === "replays" ? requestedFilter : "all";
  function setFilter(value: "all" | Media["kind"]) {
    const query = new URLSearchParams(search.toString());
    if (value === "all") query.delete("media"); else query.set("media", value);
    router.replace(`${pathname}?${query.toString()}` as Route, { scroll: false });
  }
  const auth = usePrivy(), session = useByUsSession();
  const official = useNewsSource(`/api/celebrities/${encodeURIComponent(slug)}/media?locale=${toContentLocale(locale)}`, parseOfficial, key, { key: `${auth.ready}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}`, ready: auth.ready && session.ready, getToken: async () => { if (!auth.authenticated) return null; const token = await auth.getAccessToken(); if (!token) throw Error(); return token; } });
  const youtube = useNewsSource(socialLinks.some(link => link.platform === "youtube") ? `/api/celebrities/${encodeURIComponent(slug)}/youtube` : null, parseOfficial, key);
  const instagram = useNewsSource(`/api/celebrities/${encodeURIComponent(slug)}/instagram`, parseInstagram, key);
  const chzzk = useNewsSource(channelId ? `/api/celebrities/${encodeURIComponent(slug)}/chzzk` : null, parseChzzk, key);
  const replay = useNewsSource(`/api/live-events?locale=${toContentLocale(locale)}`, parseReplay, key);
  const sources = [
    ...(filter !== "replays" ? [{ name: "ByUs", resource: official }, { name: "Instagram", resource: instagram }] : []),
    ...(channelId && (filter === "all" || filter === "photos") ? [{ name: "CHZZK", resource: chzzk }] : []),
    ...(filter === "all" || filter === "replays" ? [{ name: c.replays, resource: replay }] : []),
    ...(socialLinks.some(link => link.platform === "youtube") && (filter === "all" || filter === "videos") ? [{ name: "YouTube", resource: youtube }] : []),
  ];
  const items: Media[] = [...official.state.data.map(item => ({ ...item, source: "ByUs" })), ...instagram.state.data.map(item => ({ ...item, source: "Instagram" })), ...youtube.state.data.map(item => ({ ...item, source: "YouTube" })), ...chzzk.state.data.map(item => ({ ...item, source: "CHZZK", href: `https://chzzk.naver.com/${channelId}/community` })), ...replay.state.data.filter(item => item.slug === slug).map(item => ({ ...item, source: c.replays }))]
    .filter(item => filter === "all" || item.kind === filter).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
  return <section className={`${styles.panel} ${mediaStyles.panel}`} aria-label={`${c.photos} · ${c.videos}`}>
    <header className={mediaStyles.heading}><h2>{c.photos} · {c.videos}</h2><p>{discovery.mediaIntro}</p></header>
    {socialLinks.length > 0 && <nav className={mediaStyles.channels} aria-label={discovery.officialChannels}><span>{discovery.officialChannels}</span>{socialLinks.map(link => <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer">{({ youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", chzzk: "CHZZK" })[link.platform]}<ArrowUpRight size={14} aria-hidden="true" /></a>)}</nav>}
    <div className={styles.tabs}>{(["all", "photos", "videos", "replays"] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{c[value]}</button>)}</div>
    {sources.map(({ name, resource }) => resource.state.status !== "ready" && <div className={mediaStyles.sourceStatus} key={name} role={resource.state.status === "error" ? "alert" : "status"}><span><strong>{name}</strong> · {resource.state.status === "loading" ? c.loading : c.error}</span>{resource.state.status === "error" && <button type="button" onClick={resource.retry}>{c.retry}</button>}</div>)}
    {!items.length && sources.every(source => source.resource.state.status === "ready") && <div className={mediaStyles.empty} role="status"><strong>{filter === "all" ? `${c.photos} · ${c.videos}` : c[filter]}</strong><p>{socialLinks.length ? discovery.emptyMedia : c.empty}</p><FanAction variant="text" href={creatorHomeHref(slug, locale)}>{c.back}</FanAction></div>}
    <ul className={`${styles.media} ${mediaStyles.grid}`}>{items.map(item => <li key={item.id} data-media-kind={item.kind}><a href={item.href.startsWith("/") ? `${item.href}?locale=${locale}` : item.href} target={item.href.startsWith("/") ? undefined : "_blank"} rel={item.href.startsWith("/") ? undefined : "noopener noreferrer"}>{item.asset ? <ContentAssetImage asset={item.asset} locale={locale} alt="" /> : item.image ? <Image src={item.image} width={640} height={480} alt="" unoptimized referrerPolicy="no-referrer" /> : <span className={styles.videoLink} aria-hidden="true">▶</span>}<strong>{item.title.slice(0, 120) || c[item.kind]}</strong><span className={mediaStyles.meta}>{item.source} · {c[item.kind]}{!item.href.startsWith("/") && <ArrowUpRight size={12} aria-hidden="true" />} · <time dateTime={item.date}>{new Date(item.date).toLocaleDateString(locale)}</time></span></a></li>)}</ul>
    {filter !== "replays" && official.state.nextCursor && <FanAction onClick={official.loadMore} disabled={official.state.moreLoading}>ByUs · {official.state.moreLoading ? c.loading : c.more}</FanAction>}
    {filter !== "replays" && official.state.moreError && <ParticipationState locale={locale} status="error" retry={official.loadMore} />}
    {(filter === "all" || filter === "photos") && chzzk.state.nextCursor && <FanAction onClick={chzzk.loadMore} disabled={chzzk.state.moreLoading}>CHZZK · {chzzk.state.moreLoading ? c.loading : c.more}</FanAction>}
    {(filter === "all" || filter === "photos") && chzzk.state.moreError && <ParticipationState locale={locale} status="error" retry={chzzk.loadMore} />}
  </section>;
}
