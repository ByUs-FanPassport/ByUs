"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useId, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanHeading } from "@/components/fan-ui/fan-heading";
import { useCommunityResource } from "@/features/fanpage/ui/use-community-resource";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { postSchema, commentPageSchema } from "../domain/content";
import { PostCard } from "./post-card";
import { ContentActions, ContentTranslation } from "@/features/content-safety/ui/content-actions";
import { useContentMutation } from "@/features/content-safety/ui/use-content-mutation";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/content-safety/ui/content.module.css";
const parsePost = (value: unknown) => postSchema.parse((value as { post?: unknown })?.post);
const parseComments = (value: unknown) => commentPageSchema.parse(value);

export function FanPostDetail(props: { postId: string; locale: AppLocale }) {
  const auth = usePrivy();
  return <DetailForOwner key={`${props.postId}:${props.locale}:${auth.authenticated}:${auth.user?.id}`} {...props} />;
}
function DetailForOwner({ postId, locale }: { postId: string; locale: AppLocale }) {
  const copy = contentCopy(locale), auth = usePrivy(), mutation = useContentMutation(locale), fieldId = useId(), router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null), [body, setBody] = useState(""), [parentId, setParentId] = useState<string | null>(null), [replyTarget, setReplyTarget] = useState<{ id: string; nickname: string; body: string } | null>(null);
  const attempt = useRef<{ snapshot: string; key: string } | null>(null);
  const replyTrigger = useRef<HTMLButtonElement | null>(null), restoreReplyFocus = useRef(false);
  const post = useCommunityResource(`/api/posts/${postId}?locale=${toContentLocale(locale)}`, parsePost, false);
  const comments = useCommunityResource(`/api/posts/${postId}/comments?locale=${toContentLocale(locale)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, parseComments, false);
  useEffect(() => { if (!parentId && restoreReplyFocus.current) { restoreReplyFocus.current = false; replyTrigger.current?.focus(); } }, [parentId]);
  const refresh = () => { post.retry(); comments.retry(); };
  async function submit() {
    const value = { body: body.trim(), parentId }, snapshot = JSON.stringify(value);
    if (!attempt.current || attempt.current.snapshot !== snapshot) attempt.current = { snapshot, key: crypto.randomUUID() };
    if (await mutation.request(`/api/posts/${postId}/comments`, "POST", { ...value, idempotencyKey: attempt.current.key })) {
      setBody(""); setParentId(null); setReplyTarget(null); setCursor(null); attempt.current = null; refresh();
    }
  }
  async function remove(id: string) { if (window.confirm(copy.deleteConfirm) && await mutation.request(`/api/post-comments/${id}`, "DELETE")) refresh(); }
  if (post.state.status !== "ready") return <p role="status" className={styles.status}>{post.state.status === "loading" ? copy.loading : copy.unavailable}{post.state.status === "error" && <button className={styles.button} onClick={post.retry}>{copy.retry}</button>}</p>;
  const data = post.state.data, returnTo = `/c/${data.celebritySlug}/community/${postId}?locale=${locale}`;
  const communityHref = `${creatorHomeHref(data.celebritySlug)}?tab=community&locale=${locale}` as Route;
  return <section className={`${styles.section} ${styles.postDetail}`}>
    <FanAction href={communityHref} variant="text" leadingIcon={<ArrowLeft />}>{copy.back}</FanAction>
    <FanHeading as="h1" variant="personal-page">{copy.community}</FanHeading><PostCard post={data} locale={locale} onChanged={refresh} onDeleted={() => router.replace(communityHref)} detail />
    <section className={styles.section} aria-labelledby={`${fieldId}-heading`}><h2 id={`${fieldId}-heading`}>{copy.comments}</h2>
      {auth.ready && (auth.authenticated ? <form className={styles.composer} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {replyTarget && <div id={`${fieldId}-reply-target`} className={styles.row}><span className={styles.status}>{copy.replying}: <strong>{replyTarget.nickname}</strong> · {replyTarget.body.length > 80 ? `${replyTarget.body.slice(0, 80)}…` : replyTarget.body}</span><button type="button" className={styles.button} onClick={() => { restoreReplyFocus.current = true; setParentId(null); setReplyTarget(null); }}>{copy.cancel}</button></div>}
        <label htmlFor={fieldId}>{copy.newComment}<textarea id={fieldId} rows={3} required maxLength={1000} disabled={mutation.busy} value={body} aria-describedby={replyTarget ? `${fieldId}-reply-target` : undefined} onChange={event => setBody(event.target.value)} /></label>
        <FanAction type="submit" variant="primary" disabled={mutation.busy || !body.trim()}>{mutation.busy ? copy.loading : copy.send}</FanAction>
      </form> : <FanAction href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.login}</FanAction>)}
      {mutation.error && <p role="alert" className={styles.error}>{mutation.error}</p>}
      {comments.state.status === "ready" ? <>
        {!comments.state.data.items.length ? <p className={styles.empty}>{copy.newComment}</p> : <ul className={styles.list}>{comments.state.data.items.map(comment => <li key={comment.id} id={`comment-${comment.id}`} className={`${styles.card} ${comment.parentId ? styles.reply : ""}`}>
          <div className={styles.meta}><img src={comment.author.avatarUrl} alt="" width={28} height={28} /><strong>{comment.author.nickname}</strong>{comment.parentId && <span>{copy.reply}</span>}<time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(comment.createdAt))}</time></div>
          <ContentTranslation targetType="fan_post_comment" targetId={comment.id} sourceRevision={comment.revision} locale={locale}><p className={styles.body}>{comment.body}</p></ContentTranslation>
          <div className={styles.actions}>{auth.authenticated && !comment.parentId && <button type="button" disabled={mutation.busy} onClick={event => { replyTrigger.current = event.currentTarget; setParentId(comment.id); setReplyTarget({ id: comment.id, nickname: comment.author.nickname, body: comment.body }); document.getElementById(fieldId)?.focus(); }}>{copy.reply}</button>}{comment.isOwner && <button type="button" disabled={mutation.busy} onClick={() => void remove(comment.id)}>{copy.delete}</button>}</div>
          {!comment.isOwner && <ContentActions targetType="fan_post_comment" targetId={comment.id} locale={locale} onChanged={refresh} />}
        </li>)}</ul>}
        {(cursor || comments.state.data.nextCursor) && <nav className={styles.pagination} aria-label={copy.comments}>{cursor && <button onClick={() => setCursor(null)}>{copy.newest}</button>}{comments.state.data.nextCursor && <button onClick={() => setCursor(comments.state.status === "ready" ? comments.state.data.nextCursor : null)}>{copy.older}</button>}</nav>}
      </> : <p role="status" className={styles.status}>{comments.state.status === "loading" ? copy.loading : copy.failed}{comments.state.status === "error" && <button className={styles.button} onClick={comments.retry}>{copy.retry}</button>}</p>}
    </section>
  </section>;
}
