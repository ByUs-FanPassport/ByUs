"use client";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Heart, MessageCircle } from "lucide-react";
import type { FanPost } from "../domain/content";
import { PostComposer } from "./post-composer";
import { ContentActions, ContentTranslation } from "@/features/content-safety/ui/content-actions";
import { ContentAssetImage } from "@/features/content-safety/ui/content-asset";
import { useContentMutation } from "@/features/content-safety/ui/use-content-mutation";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import type { AppLocale } from "@/i18n/locales";
import styles from "@/features/content-safety/ui/content.module.css";

export function PostCard({ post, locale, onChanged, detail = false }: { post: FanPost; locale: AppLocale; onChanged: () => void; detail?: boolean }) {
  const auth = usePrivy(), copy = contentCopy(locale), mutation = useContentMutation(locale), [editing, setEditing] = useState(false);
  const href = `/c/${post.celebritySlug}/community/${post.id}?locale=${locale}` as Route;
  async function remove() { if (window.confirm(copy.deleteConfirm) && await mutation.request(`/api/posts/${post.id}`, "DELETE")) onChanged(); }
  async function like() { if (await mutation.request(`/api/posts/${post.id}/like`, "PUT", { liked: !post.liked })) onChanged(); }
  if (editing) return <PostComposer slug={post.celebritySlug} locale={locale} post={post} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />;
  return <article className={styles.card} data-post-id={post.id}>
    <header className={styles.meta}><img src={post.author.avatarUrl} alt="" width={32} height={32} /><strong>{post.author.nickname}</strong>
      <time dateTime={post.createdAt}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(post.createdAt))}</time>
      <span className={styles.badge}>{post.visibility === "members" ? copy.members : copy.public}</span>
    </header>
    {post.body && <ContentTranslation targetType="fan_post" targetId={post.id} locale={locale} sourceRevision={post.revision}><p className={styles.body}>{post.body}</p></ContentTranslation>}
    {post.assets.length > 0 && <div className={styles.photos}>{post.assets.map(asset => <ContentAssetImage key={asset.id} asset={asset} locale={locale} alt={copy.photo} />)}</div>}
    <div className={styles.actions}><button type="button" onClick={() => void like()} disabled={!auth.ready || !auth.authenticated || mutation.busy} aria-pressed={post.liked}><Heart size={16} aria-hidden="true" /> {copy.like} {post.likeCount.toLocaleString(locale)}</button>
      {!detail && <Link href={href} className={styles.button}><MessageCircle size={16} aria-hidden="true" /> {copy.comments} {post.commentCount.toLocaleString(locale)}</Link>}
      {post.isOwner && <><button type="button" disabled={mutation.busy} onClick={() => setEditing(true)}>{copy.edit}</button><button type="button" disabled={mutation.busy} onClick={() => void remove()}>{copy.delete}</button></>}
    </div>
    <ContentActions targetType="fan_post" targetId={post.id} locale={locale} canBlock={!post.isOwner} onChanged={onChanged} />
    {mutation.error && <p className={styles.error} role="alert">{mutation.error}</p>}
  </article>;
}
