"use client";
import { useId, useRef, useState } from "react";
import { MessageCircle, PenLine } from "lucide-react";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { useCommunityResource } from "@/features/fanpage/ui/use-community-resource";
import { postPageSchema } from "../domain/content";
import { PostCard } from "./post-card";
import { PostComposer } from "./post-composer";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/content-safety/ui/content.module.css";
const parse = (value: unknown) => postPageSchema.parse(value);

export function FanPostFeed(props: { slug: string; locale: AppLocale }) {
  const auth = usePrivy();
  return <FeedForOwner key={`${props.slug}:${props.locale}:${auth.authenticated}:${auth.user?.id}`} {...props} />;
}
function FeedForOwner({ slug, locale }: { slug: string; locale: AppLocale }) {
  const auth = usePrivy(), copy = contentCopy(locale), heading = useId(), [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [composing, setComposing] = useState(false), composeTrigger = useRef<HTMLButtonElement>(null);
  const discovery = discoveryCopy(locale);
  const closeComposer = () => { setComposing(false); requestAnimationFrame(() => composeTrigger.current?.focus()); };
  const cursor = cursors.at(-1) ?? null;
  const resource = useCommunityResource(`/api/celebrities/${slug}/posts?locale=${toContentLocale(locale)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, parse, false);
  const refresh = () => { setCursors([null]); resource.retry(); closeComposer(); };
  const returnTo = `${creatorHomeHref(slug)}?tab=community&locale=${locale}#celebrity-content`;
  return <section className={styles.section} aria-labelledby={heading}><header className={styles.feedHeading}><h2 id={heading}>{copy.community}</h2><p>{discovery.communityIntro}</p></header>
    {auth.ready && (auth.authenticated ? (composing ? <PostComposer slug={slug} locale={locale} onSaved={refresh} onCancel={closeComposer} featured autoFocus /> : <button ref={composeTrigger} type="button" className={styles.composeTrigger} onClick={() => setComposing(true)} aria-label={copy.writePost}><span className={styles.composeIcon}><PenLine size={20} aria-hidden="true" /></span><span>{discovery.writePrompt}</span><strong>{copy.writePost}</strong></button>) : <FanAction href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.login}</FanAction>)}
    {resource.state.status === "ready" ? <>
      {resource.state.data.items.length ? <ul className={styles.list}>{resource.state.data.items.map(post => <li key={post.id}><PostCard post={post} locale={locale} onChanged={resource.retry} /></li>)}</ul> : <div className={styles.feedEmpty} role="status"><MessageCircle size={28} aria-hidden="true" /><p>{copy.empty}</p></div>}
      {(cursor || resource.state.data.nextCursor) && <nav className={styles.pagination} aria-label={copy.community}>{cursor && <><button type="button" onClick={() => setCursors([null])}>{copy.newest}</button>{cursors.length > 2 && <button type="button" onClick={() => setCursors(current => current.slice(0, -1))}>{copy.newer}</button>}</>}{resource.state.data.nextCursor && <button type="button" onClick={() => setCursors(current => [...current, resource.state.status === "ready" ? resource.state.data.nextCursor : null])}>{copy.older}</button>}</nav>}
    </> : <p role="status" className={styles.status}>{resource.state.status === "loading" ? copy.loading : copy.failed}{resource.state.status === "error" && <button type="button" className={styles.button} onClick={resource.retry}>{copy.retry}</button>}</p>}
  </section>;
}
