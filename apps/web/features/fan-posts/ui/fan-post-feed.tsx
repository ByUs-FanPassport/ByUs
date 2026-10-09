"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, PenLine, X } from "lucide-react";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useCommunityResource } from "@/features/fanpage/ui/use-community-resource";
import type { NewsFilter } from "@/features/fanpage/ui/chzzk-posts";
import { boardHref, type BoardFeedSource } from "@/features/fanpage/domain/board-navigation";
import { feedPageSchema } from "../domain/feed";
import { FeedItemCard } from "./feed-item-card";
import { PostComposer } from "./post-composer";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { feedCopy } from "@/i18n/catalogs/features__fan_posts__feed";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/content-safety/ui/content.module.css";
import feedStyles from "./fan-post-feed.module.css";

const parse = (value: unknown) => feedPageSchema.parse(value);
type Props = { slug: string; locale: AppLocale; creatorName?: string; returnTo?: string; source?: BoardFeedSource; newsFilter?: NewsFilter; hideHeading?: boolean };
export function FanPostFeed(props: Props) {
  const auth = usePrivy(), session = useByUsSession();
  return <FeedForOwner key={`${props.slug}:${props.locale}:${props.source}:${props.newsFilter}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}`} {...props} />;
}
function FeedForOwner({ slug, locale, creatorName, returnTo = boardHref(slug, locale, { source: "fans" }), source, newsFilter = "all", hideHeading = false }: Props) {
  const auth = usePrivy(), session = useByUsSession(), copy = contentCopy(locale), feed = feedCopy(locale), heading = useId();
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [composing, setComposing] = useState(false);
  const composeTrigger = useRef<HTMLButtonElement>(null), section = useRef<HTMLElement>(null);
  const closeComposer = () => { setComposing(false); requestAnimationFrame(() => composeTrigger.current?.focus()); };
  const cursor = cursors.at(-1) ?? null, selectedSource = source ?? "fans";
  const query = new URLSearchParams({ locale: toContentLocale(locale), source: selectedSource });
  if (cursor) query.set("cursor", cursor);
  if (newsFilter !== "all") query.set("news", newsFilter);
  const resource = useCommunityResource(`/api/celebrities/${slug}/feed?${query}`, parse, false);
  const refresh = () => { setCursors([null]); resource.retry(); };
  const saved = () => { refresh(); closeComposer(); };
  const goToPage = (next: (string | null)[]) => { setCursors(next); section.current?.focus(); section.current?.scrollIntoView?.({ block: "start" }); };
  const filterLabel = newsFilter === "notice" ? copy.notice : newsFilter === "artist_post" ? copy.artistPost : "CHZZK";
  const sessionReady = auth.ready && session.ready;
  return <section id="cheers" ref={section} tabIndex={-1} className={`${styles.section} ${feedStyles.feed}`} aria-labelledby={heading} data-unified-feed="">
    <header className={feedStyles.heading}><h2 id={heading} className={hideHeading ? feedStyles.visuallyHidden : undefined}>{source ? feed.feed : feed.fanBoard}</h2><p>{source ? feed.intro : discoveryCopy(locale).communityIntro}</p></header>
    {source && <div className={feedStyles.toolbar}><nav className={feedStyles.filters} aria-label={feed.filters}>{(["all", "official", "fans"] as const).map(value => <Link key={value} href={boardHref(slug, locale, { source: value })} aria-current={selectedSource === value ? "page" : undefined}>{feed[value]}</Link>)}</nav>
      {newsFilter !== "all" && <span className={feedStyles.topic}>{filterLabel}<Link href={boardHref(slug, locale, { source: "official" })} aria-label={feed.removeFilter}><X size={16} aria-hidden="true" /></Link></span>}
    </div>}
    {selectedSource !== "official" && sessionReady && (auth.authenticated ? (composing ? <PostComposer slug={slug} locale={locale} onSaved={saved} onCancel={closeComposer} featured autoFocus /> : <button ref={composeTrigger} type="button" className={styles.composeTrigger} onClick={() => setComposing(true)} aria-label={copy.writePost}><span className={styles.composeIcon}><PenLine size={20} aria-hidden="true" /></span><span>{discoveryCopy(locale).writePrompt}</span><strong>{copy.writePost}</strong></button>) : <FanAction href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.login}</FanAction>)}
    {resource.state.status === "ready" ? <>
      {resource.state.data.unavailableSources.length > 0 && <div className={feedStyles.sourceStatus} role="status"><p>{feed.sourceError}</p><FanAction variant="text" onClick={refresh}>{copy.retry}</FanAction></div>}
      {resource.state.data.items.length ? <ul className={styles.list}>{resource.state.data.items.map(item => <li key={`${item.kind}:${item.id}`}><FeedItemCard item={item} slug={slug} creatorName={creatorName} locale={locale} returnTo={returnTo} onChanged={resource.retry} /></li>)}</ul> : !resource.state.data.nextCursor && !resource.state.data.unavailableSources.length ? <div className={styles.feedEmpty} role="status"><MessageCircle size={28} aria-hidden="true" /><p>{copy.empty}</p></div> : null}
      {(cursor || resource.state.data.nextCursor) && <nav className={`${styles.pagination} ${feedStyles.pagination}`} aria-label={source ? feed.feed : feed.fanBoard}>{cursor && <><button type="button" onClick={() => goToPage([null])}>{copy.newest}</button>{cursors.length > 2 && <button type="button" onClick={() => goToPage(cursors.slice(0, -1))}>{copy.newer}</button>}</>}{resource.state.data.nextCursor && <button type="button" onClick={() => goToPage([...cursors, resource.state.status === "ready" ? resource.state.data.nextCursor : null])}>{copy.older}</button>}</nav>}
    </> : <div role={resource.state.status === "error" ? "alert" : "status"} className={styles.status}>{resource.state.status === "loading" ? copy.loading : resource.state.code === "FEED_CURSOR_EXPIRED" ? feed.cursorExpired : copy.failed}{resource.state.status === "error" && <button type="button" className={styles.button} onClick={refresh}>{cursor ? feed.refresh : copy.retry}</button>}</div>}
  </section>;
}
