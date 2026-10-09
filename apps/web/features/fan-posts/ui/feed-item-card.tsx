"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Menu } from "@base-ui/react/menu";
import { generateText, type JSONContent } from "@tiptap/core";
import { BadgeCheck, Ellipsis, MessageCircle, Pin } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { AlertDialog } from "@/components/ui/overlay/accessible-overlay";
import { rememberOverlayTrigger } from "@/components/ui/overlay/focus-return";
import { FanAction, fanActionClassName } from "@/components/fan-ui/fan-action";
import { notifyFanActivityUpdated } from "@/components/fan-ui/fan-activity-updates";
import { noticeExtensions } from "@/components/notice/tiptap-extensions";
import { ContentActions, ContentTranslation } from "@/features/content-safety/ui/content-actions";
import { ContentAssetImage } from "@/features/content-safety/ui/content-asset";
import { useContentMutation } from "@/features/content-safety/ui/use-content-mutation";
import { noticeMedia } from "@/features/media/domain/official-media";
import { parseNoticeDocument } from "@/server/notice/notice-domain";
import type { AppLocale } from "@/i18n/locales";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { feedCopy } from "@/i18n/catalogs/features__fan_posts__feed";
import type { FeedItem } from "../domain/feed";
import { PostCard } from "./post-card";
import styles from "@/features/content-safety/ui/content.module.css";
import feedStyles from "./fan-post-feed.module.css";

type Props = { item: FeedItem; slug: string; creatorName?: string; locale: AppLocale; returnTo: string; onChanged: () => void };
const dateLabel = (date: string, locale: AppLocale) => new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", ...(date.length > 10 ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Seoul" }).format(new Date(date));

export function FeedItemCard(props: Props) {
  const { item, slug, locale, creatorName, returnTo, onChanged } = props;
  const copy = contentCopy(locale), feed = feedCopy(locale);
  if (item.kind === "fan_post") return <PostCard post={item} locale={locale} returnTo={returnTo} onChanged={onChanged} />;
  if (item.kind === "cheer") return <CheerCard item={item} locale={locale} onChanged={onChanged} />;
  if (item.kind === "chzzk") {
    const href = `/c/${slug}/updates/chzzk/${item.id}?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}` as Route;
    return <article className={feedStyles.card} data-feed-kind="chzzk">
      <header className={styles.meta}><span className={feedStyles.officialMark}><BadgeCheck size={20} aria-hidden="true" /></span><strong>{creatorName ?? feed.official}</strong><span>CHZZK</span><time dateTime={item.date}>{dateLabel(item.date, locale)}</time></header>
      {item.text && <p className={`${styles.body} ${feedStyles.excerpt}`}>{item.text}</p>}
      {item.images[0] && <Link href={href} className={feedStyles.media} aria-label={feed.readPost}><img src={item.images[0].url} alt="" loading="lazy" referrerPolicy="no-referrer" /></Link>}
      <div className={styles.actions}><Link href={href} className={styles.button}>{feed.readPost}</Link></div>
    </article>;
  }
  const notice = { ...item, kind: item.noticeKind };
  const text = generateText(parseNoticeDocument(item.body) as JSONContent, noticeExtensions);
  const media = noticeMedia(notice, slug).find(asset => asset.kind === "photos");
  const href = `/c/${slug}/notices/${item.slug}?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}` as Route;
  return <article className={feedStyles.card} data-feed-kind="notice">
    <header className={styles.meta}>
      <span className={feedStyles.officialMark}><BadgeCheck size={20} aria-hidden="true" /></span>
      <strong>{item.postType === "artist_post" ? creatorName ?? feed.official : "ByUs"}</strong>
      <span className={feedStyles.officialLabel}>{item.pinned && <Pin size={14} aria-hidden="true" />}{item.postType === "artist_post" ? copy.artistPost : copy.notice}</span>
      <time dateTime={item.publishedAt}>{dateLabel(item.publishedAt, locale)}</time>
      {item.visibility === "members" && <span className={styles.badge}>{copy.members}</span>}
      <ContentActions targetType="notice" targetId={item.id} locale={locale} canBlock={false} onChanged={onChanged} />
    </header>
    <Link className={feedStyles.title} href={href}>{item.title}</Link>
    {text && <ContentTranslation sourceText={`${item.title}\n${text}`} targetType="notice" targetId={item.id} sourceRevision={item.revision} locale={locale}><p className={`${styles.body} ${feedStyles.excerpt}`}>{text}</p></ContentTranslation>}
    {media && <Link href={href} className={feedStyles.media} aria-label={feed.readPost}>{media.asset ? <ContentAssetImage asset={media.asset} locale={locale} alt={media.title} /> : media.image ? <img src={media.image} alt={media.title} loading="lazy" /> : null}</Link>}
    <div className={styles.actions}><Link href={href} className={styles.button}>{feed.readPost}</Link><Link href={`${href}#comments` as Route} className={styles.button}><MessageCircle size={16} aria-hidden="true" />{copy.comments} {item.commentCount.toLocaleString(locale)}</Link></div>
  </article>;
}

function CheerCard({ item, locale, onChanged }: { item: Extract<FeedItem, { kind: "cheer" }>; locale: AppLocale; onChanged: () => void }) {
  const auth = usePrivy(), session = useByUsSession(), mutation = useContentMutation(locale), copy = contentCopy(locale), id = useId();
  const [confirming, setConfirming] = useState(false), trigger = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null);
  async function remove() {
    if (await mutation.request(`/api/cheers/${item.id}`, "DELETE")) { setConfirming(false); notifyFanActivityUpdated(session.ownerId ?? auth.user?.id); onChanged(); }
  }
  return <article className={feedStyles.card} data-cheer-id={item.id}>
    <header className={styles.meta}><img src={item.avatarUrl} alt="" width={32} height={32} /><strong>{item.nickname}</strong><time dateTime={item.createdAt}>{dateLabel(item.createdAt, locale)}</time>
      {item.isOwner ? <Menu.Root disabled={mutation.busy}><Menu.Trigger ref={trigger} className={styles.moreTrigger} aria-label={copy.more}><Ellipsis size={20} aria-hidden="true" /></Menu.Trigger>
        <Menu.Portal><Menu.Positioner className={styles.menuPositioner} sideOffset={4} align="end"><Menu.Popup className={styles.menuPopup}><Menu.Item className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => { if (trigger.current) rememberOverlayTrigger(trigger.current); setConfirming(true); }}>{copy.delete}</Menu.Item></Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root> : <ContentActions targetType="cheer" targetId={item.id} locale={locale} onChanged={onChanged} />}
    </header>
    <ContentTranslation sourceText={item.body} targetType="cheer" targetId={item.id} locale={locale}><p className={styles.body}>{item.body}</p></ContentTranslation>
    {confirming && <AlertDialog open onClose={() => setConfirming(false)} labelledBy={`${id}-delete`} initialFocusRef={cancel} busy={mutation.busy} backdropClassName={styles.reportBackdrop} contentClassName={styles.reportDialog}>
      <h2 id={`${id}-delete`}>{copy.deleteConfirm}</h2><div className={styles.actions}><button ref={cancel} type="button" className={fanActionClassName("neutral")} disabled={mutation.busy} onClick={() => setConfirming(false)}>{copy.cancel}</button><FanAction disabled={mutation.busy} onClick={() => void remove()}>{copy.delete}</FanAction></div>
      {mutation.error && <p className={styles.error} role="alert">{mutation.error}</p>}
    </AlertDialog>}
  </article>;
}
