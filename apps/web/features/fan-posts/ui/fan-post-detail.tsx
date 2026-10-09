"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useEffect, useId, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanHeading } from "@/components/fan-ui/fan-heading";
import { sanitizeReturnTo } from "@/components/login-intent";
import { useCommunityResource } from "@/features/fanpage/ui/use-community-resource";
import { communityHref as hubHref } from "@/features/community/domain/navigation";
import { postSchema, commentPageSchema } from "../domain/content";
import { PostCard } from "./post-card";
import { ContentActions, ContentTranslation } from "@/features/content-safety/ui/content-actions";
import { useContentMutation } from "@/features/content-safety/ui/use-content-mutation";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/content-safety/ui/content.module.css";
import commentStyles from "./post-comments.module.css";
const parsePost = (value: unknown) => postSchema.parse((value as { post?: unknown })?.post);
const parseComments = (value: unknown) => commentPageSchema.parse(value);

export function FanPostDetail(props: { postId: string; locale: AppLocale }) {
  const auth = usePrivy();
  return <DetailForOwner key={`${props.postId}:${props.locale}:${auth.authenticated}:${auth.user?.id}`} {...props} />;
}
function DetailForOwner({ postId, locale }: { postId: string; locale: AppLocale }) {
  const copy = contentCopy(locale), auth = usePrivy(), mutation = useContentMutation(locale), fieldId = useId(), router = useRouter(), searchParams = useSearchParams();
  const [cursor, setCursor] = useState<string | null>(null), [body, setBody] = useState(""), [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({}), [replyTarget, setReplyTarget] = useState<{ id: string; nickname: string; body: string } | null>(null);
  const parentId = replyTarget?.id ?? null;
  const draft = parentId ? replyDrafts[parentId] ?? "" : body;
  const attempt = useRef<{ snapshot: string; key: string } | null>(null);
  const replyTrigger = useRef<HTMLButtonElement | null>(null), restoreReplyFocus = useRef(false);
  const post = useCommunityResource(`/api/posts/${postId}?locale=${toContentLocale(locale)}`, parsePost, false);
  const comments = useCommunityResource(`/api/posts/${postId}/comments?locale=${toContentLocale(locale)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, parseComments, false);
  useEffect(() => {
    if (post.state.status !== "ready") return;
    if (replyTarget) {
      const field = document.getElementById(fieldId);
      field?.focus({ preventScroll: true });
      field?.closest("form")?.scrollIntoView({ block: "nearest" });
    }
    else if (restoreReplyFocus.current) {
      restoreReplyFocus.current = false;
      (replyTrigger.current?.isConnected ? replyTrigger.current : document.getElementById(fieldId))?.focus();
    }
  }, [replyTarget, fieldId, post.state.status]);
  const refresh = () => { post.retry(); comments.retry(); };
  async function submit() {
    if (mutation.busy || !draft.trim()) return;
    const value = { body: draft.trim(), parentId }, snapshot = JSON.stringify(value);
    if (!attempt.current || attempt.current.snapshot !== snapshot) attempt.current = { snapshot, key: crypto.randomUUID() };
    if (await mutation.request(`/api/posts/${postId}/comments`, "POST", { ...value, idempotencyKey: attempt.current.key })) {
      if (parentId) setReplyDrafts(previous => ({ ...previous, [parentId]: "" }));
      else setBody("");
      restoreReplyFocus.current = Boolean(parentId);
      setReplyTarget(null); setCursor(null); attempt.current = null; refresh();
    }
  }
  async function remove(id: string) { if (window.confirm(copy.deleteConfirm) && await mutation.request(`/api/post-comments/${id}`, "DELETE")) refresh(); }
  if (post.state.status !== "ready") return <p role="status" className={styles.status}>{post.state.status === "loading" ? copy.loading : copy.unavailable}{post.state.status === "error" && <button className={styles.button} onClick={post.retry}>{copy.retry}</button>}</p>;
  const data = post.state.data, requestedReturn = searchParams.get("returnTo"), safeReturn = sanitizeReturnTo(requestedReturn);
  const communityHref = (requestedReturn && (safeReturn !== "/" || requestedReturn === "/") ? safeReturn : hubHref(data.celebritySlug, locale)) as Route;
  const returnTo = `/c/${data.celebritySlug}/community/${postId}?locale=${locale}&returnTo=${encodeURIComponent(communityHref)}`;
  const composer = <form className={commentStyles.composer} aria-busy={mutation.busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
    {replyTarget && <div id={`${fieldId}-reply-target`} className={commentStyles.target}>
      <span>{copy.replying}: <strong>{replyTarget.nickname}</strong></span>
      <p>{replyTarget.body.length > 80 ? `${replyTarget.body.slice(0, 80)}…` : replyTarget.body}</p>
    </div>}
    <label className={commentStyles.label} htmlFor={fieldId}>{replyTarget ? copy.reply : copy.newComment}</label>
    <textarea id={fieldId} rows={2} required maxLength={1000} disabled={mutation.busy} value={draft} aria-describedby={replyTarget ? `${fieldId}-reply-target` : undefined} onChange={event => {
      const value = event.target.value;
      if (parentId) setReplyDrafts(previous => ({ ...previous, [parentId]: value }));
      else setBody(value);
    }} />
    {mutation.error && replyTarget && <p role="alert" className={styles.error}>{mutation.error}</p>}
    <div className={commentStyles.tools}>
      {replyTarget && <FanAction type="button" variant="text" disabled={mutation.busy} onClick={() => { restoreReplyFocus.current = true; setReplyTarget(null); }}>{copy.cancel}</FanAction>}
      <FanAction type="submit" variant="neutral" ariaBusy={mutation.busy} disabled={mutation.busy || !draft.trim()}>{mutation.busy ? copy.loading : copy.send}</FanAction>
    </div>
  </form>;
  return <section className={`${styles.section} ${styles.postDetail}`}>
    <FanAction href={communityHref} variant="text" leadingIcon={<ArrowLeft />}>{copy.back}</FanAction>
    <FanHeading as="h1" variant="personal-page">{copy.community}</FanHeading><PostCard post={data} locale={locale} returnTo={communityHref} onChanged={refresh} onDeleted={() => router.replace(communityHref)} detail />
    <section className={styles.section} aria-labelledby={`${fieldId}-heading`}><h2 id={`${fieldId}-heading`}>{copy.comments}</h2>
      {auth.ready && (auth.authenticated ? !replyTarget && composer : <FanAction href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.login}</FanAction>)}
      {mutation.error && !replyTarget && <p role="alert" className={styles.error}>{mutation.error}</p>}
      {comments.state.status === "ready" ? <>
        {!comments.state.data.items.length ? <p className={styles.empty}>{copy.newComment}</p> : <ul className={`${styles.list} ${commentStyles.list}`}>{comments.state.data.items.map(comment => <li key={comment.id} id={`comment-${comment.id}`} className={`${styles.card} ${comment.parentId ? styles.reply : ""}`}>
          <div className={styles.meta}><img src={comment.author.avatarUrl} alt="" width={28} height={28} /><strong>{comment.author.nickname}</strong>{comment.parentId && <span>{copy.reply}</span>}<time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(comment.createdAt))}</time></div>
          <ContentTranslation sourceText={comment.body} targetType="fan_post_comment" targetId={comment.id} sourceRevision={comment.revision} locale={locale}><p className={styles.body}>{comment.body}</p></ContentTranslation>
          <div className={styles.actions}>{auth.authenticated && !comment.parentId && <button type="button" disabled={mutation.busy} onClick={event => { replyTrigger.current = event.currentTarget; setReplyTarget({ id: comment.id, nickname: comment.author.nickname, body: comment.body }); }}>{copy.reply}</button>}{comment.isOwner && <button type="button" disabled={mutation.busy} onClick={() => void remove(comment.id)}>{copy.delete}</button>}
            {!comment.isOwner && <ContentActions targetType="fan_post_comment" targetId={comment.id} locale={locale} onChanged={refresh} />}
          </div>
          {replyTarget?.id === comment.id && <div className={commentStyles.inlineReply}>{composer}</div>}
        </li>)}</ul>}
        {(cursor || comments.state.data.nextCursor) && <nav className={styles.pagination} aria-label={copy.comments}>{cursor && <button onClick={() => setCursor(null)}>{copy.newest}</button>}{comments.state.data.nextCursor && <button onClick={() => setCursor(comments.state.status === "ready" ? comments.state.data.nextCursor : null)}>{copy.older}</button>}</nav>}
        {replyTarget && !comments.state.data.items.some(comment => comment.id === replyTarget.id) && composer}
      </> : <><p role="status" className={styles.status}>{comments.state.status === "loading" ? copy.loading : copy.failed}{comments.state.status === "error" && <button className={styles.button} onClick={comments.retry}>{copy.retry}</button>}</p>{replyTarget && composer}</>}
    </section>
  </section>;
}
