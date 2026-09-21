"use client";
import { toContentLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__notice-comments";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import { usePrivy } from "@privy-io/react-auth";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { commentsSchema } from "../domain/community";
import { useFanpageResource } from "./use-fanpage-resource";
import previewStyles from "./fanpage.module.css";
import detailStyles from "./notice-comments.module.css";

const parseComments = (value: unknown) => commentsSchema.extend({ nextCursor: z.string().nullable() }).parse(value);
export function NoticeComments({ slug, noticeSlug, locale, preview = false, welcome = false }: { slug: string; noticeSlug: string; locale: AppLocale; preview?: boolean; welcome?: boolean }) {
  const auth = usePrivy();
  return <CommentsForOwner key={`${slug}:${noticeSlug}:${auth.user?.id ?? "guest"}`} {...{ slug, noticeSlug, locale, preview, welcome }} />;
}
function CommentsForOwner({ slug, noticeSlug, locale, preview, welcome }: { slug: string; noticeSlug: string; locale: AppLocale; preview: boolean; welcome: boolean }) {
  const { authenticated, ready, getAccessToken } = usePrivy();
  const ko = locale === "ko";
  const styles = preview ? previewStyles : detailStyles;
  const Heading = preview ? "h3" : "h2";
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useFanpageResource(`/api/celebrities/${slug}/notices/${noticeSlug}/comments?locale=${toContentLocale(locale)}&limit=${preview ? 2 : 20}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, parseComments);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const submitting = useRef(false);
  async function mutate(id?: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error();
      const trimmed = body.trim();
      if (!id && (!attempt.current || attempt.current.body !== trimmed)) attempt.current = { body: trimmed, key: crypto.randomUUID() };
      const response = await fetch(id ? `/api/notice-comments/${id}` : `/api/celebrities/${slug}/notices/${noticeSlug}/comments`, {
        method: id ? "DELETE" : "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: id ? undefined : JSON.stringify({ body: trimmed, idempotencyKey: attempt.current!.key }),
      });
      if (!response.ok) { setError(response.status === 429 ? (locale === "ko" ? "댓글은 잠시 후 다시 남겨 주세요." : translate(locale, localizedMessages.m3050bc7116ad, "Please wait before posting again.")) : (locale === "ko" ? "저장하지 못했어요. 다시 시도해 주세요." : translate(locale, localizedMessages.m22c6a29029bd, "Couldn't save. Please try again."))); return; }
      if (!id) { setBody(""); attempt.current = null; }
      setCursor(null); resource.retry();
    } catch { setError(locale === "ko" ? "연결을 확인하고 다시 시도해 주세요." : translate(locale, localizedMessages.m0540c5d5c62d, "Check your connection and try again.")); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className={styles.comments} aria-label={locale === "ko" ? "공지 댓글" : translate(locale, localizedMessages.m41ca49fe7bb8, "Notice comments")}>
    <div className={styles.sectionHeading}><Heading>{locale === "ko" ? "댓글" : translate(locale, localizedMessages.mf81f2c129730, "Comments")}{resource.state.status === "ready" ? ` ${resource.state.data.total}` : ""}</Heading>{preview && <Link href={`/c/${slug}/notices/${noticeSlug}?locale=${locale}#comments`}>{welcome ? (locale === "ko" ? "인사 남기기" : translate(locale, localizedMessages.m47ad8ca7cfd7, "Say hello")) : (locale === "ko" ? "댓글 전체 보기" : translate(locale, localizedMessages.m77a4109c4970, "All comments"))} →</Link>}</div>
    <div id={preview ? undefined : "comments"}>
      {resource.state.status === "loading" ? <p role="status" className={styles.muted}>{locale === "ko" ? "댓글을 불러오고 있어요." : translate(locale, localizedMessages.mf94d961ae09e, "Loading comments.")}</p> : resource.state.status === "error" ? <p role="alert">{locale === "ko" ? "댓글을 불러오지 못했어요." : translate(locale, localizedMessages.m75ec2fbb186d, "Couldn't load comments.")} <button onClick={resource.retry}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m7be9e2b0e04a, "Retry")}</button></p> : <>
        {!resource.state.data.comments.length && <p className={styles.muted}>{welcome ? (locale === "ko" ? "어떤 순간에 팬이 되셨나요? 첫 인사를 남겨주세요." : translate(locale, localizedMessages.m28934d96496a, "What made you a fan? Say hello in the comments.")) : (locale === "ko" ? "첫 댓글로 이야기를 시작해 보세요." : translate(locale, localizedMessages.ma34a3cc7c637, "Start the conversation with the first comment."))}</p>}
        <ul className={styles.commentList}>{resource.state.data.comments.map((comment) => <li key={comment.id}><img src={comment.avatarUrl} width={preview ? 32 : 40} height={preview ? 32 : 40} alt="" /><div><div className={styles.commentMeta}><strong>{comment.nickname}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(comment.createdAt))}</time>{comment.isOwner && <button disabled={busy} onClick={() => void mutate(comment.id)}>{locale === "ko" ? "삭제" : translate(locale, localizedMessages.mf859bdd4bf81, "Delete")}</button>}</div><p>{comment.body}</p></div></li>)}</ul>
        {!preview && <div className={styles.pagination}>{cursor && <button onClick={() => setCursor(null)}>{locale === "ko" ? "최신 댓글" : translate(locale, localizedMessages.m787c23318977, "Newest")}</button>}{resource.state.data.nextCursor && <button onClick={() => { if (resource.state.status === "ready") setCursor(resource.state.data.nextCursor); }}>{locale === "ko" ? "이전 댓글" : translate(locale, localizedMessages.md95599a46ca8, "Older comments")}</button>}</div>}
      </>}
    </div>
    {ready && authenticated ? <form className={styles.commentForm} onSubmit={(event) => { event.preventDefault(); void mutate(); }}><label htmlFor={`comment-${noticeSlug}`}>{locale === "ko" ? "댓글 남기기" : translate(locale, localizedMessages.medde5c8acf8b, "Leave a comment")}</label><textarea id={`comment-${noticeSlug}`} value={body} onChange={(event) => setBody(event.target.value)} aria-describedby={`comment-note-${noticeSlug}${error ? ` comment-error-${noticeSlug}` : ""}`} maxLength={1000} rows={preview ? 2 : 3} required disabled={busy} placeholder={locale === "ko" ? "함께 나누고 싶은 이야기를 남겨 주세요." : translate(locale, localizedMessages.macce2f00ffd7, "Share a thought with other fans.")} /><div><small id={`comment-note-${noticeSlug}`}>{locale === "ko" ? "닉네임과 캐릭터 아바타가 함께 공개돼요." : translate(locale, localizedMessages.me6fdaaca8e8d, "Your nickname and character avatar are public.")}</small><button type="submit" className={styles.darkButton} disabled={busy || !body.trim()}>{busy ? (locale === "ko" ? "저장 중…" : translate(locale, localizedMessages.md971c1d51fcb, "Saving…")) : (locale === "ko" ? "등록" : translate(locale, localizedMessages.m80d2b610a85f, "Post"))}</button></div></form> : ready ? <AuthIntentLink className={styles.loginComment} locale={locale} input={{ sourcePath: `/c/${slug}/notices/${noticeSlug}`, sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "celebrity", targetId: slug }}>{locale === "ko" ? "로그인하고 댓글 남기기" : translate(locale, localizedMessages.ma981a032c0ac, "Sign in to comment")}</AuthIntentLink> : null}
    {error && <p id={`comment-error-${noticeSlug}`} role="alert">{error}</p>}
  </section>;
}
