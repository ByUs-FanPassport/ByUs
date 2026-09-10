"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { commentsSchema } from "../domain/community";
import { useFanpageResource } from "./use-fanpage-resource";
import styles from "./fanpage.module.css";

const parseComments = (value: unknown) => commentsSchema.extend({ nextCursor: z.string().nullable() }).parse(value);
export function NoticeComments({ slug, noticeSlug, locale, preview = false }: { slug: string; noticeSlug: string; locale: "ko" | "en"; preview?: boolean }) {
  const auth = usePrivy();
  return <CommentsForOwner key={`${slug}:${noticeSlug}:${auth.user?.id ?? "guest"}`} {...{ slug, noticeSlug, locale, preview }} />;
}
function CommentsForOwner({ slug, noticeSlug, locale, preview }: { slug: string; noticeSlug: string; locale: "ko" | "en"; preview: boolean }) {
  const { authenticated, ready, getAccessToken } = usePrivy();
  const ko = locale === "ko";
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useFanpageResource(`/api/celebrities/${slug}/notices/${noticeSlug}/comments?locale=${locale}&limit=${preview ? 2 : 20}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, parseComments);
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
      if (!response.ok) { setError(response.status === 429 ? (ko ? "댓글은 잠시 후 다시 남겨 주세요." : "Please wait before posting again.") : (ko ? "저장하지 못했어요. 다시 시도해 주세요." : "Couldn't save. Please try again.")); return; }
      if (!id) { setBody(""); attempt.current = null; }
      setCursor(null); resource.retry();
    } catch { setError(ko ? "연결을 확인하고 다시 시도해 주세요." : "Check your connection and try again."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className={styles.comments} aria-label={ko ? "공지 댓글" : "Notice comments"}>
    <div className={styles.sectionHeading}><h3>{ko ? "댓글" : "Comments"}{resource.state.status === "ready" ? ` ${resource.state.data.total}` : ""}</h3>{preview && <Link href={`/c/${slug}/notices/${noticeSlug}?locale=${locale}#comments`}>{ko ? "댓글 전체 보기" : "All comments"} →</Link>}</div>
    <div id={preview ? undefined : "comments"}>
      {resource.state.status === "loading" ? <p role="status" className={styles.muted}>{ko ? "댓글을 불러오고 있어요." : "Loading comments."}</p> : resource.state.status === "error" ? <p role="alert">{ko ? "댓글을 불러오지 못했어요." : "Couldn't load comments."} <button onClick={resource.retry}>{ko ? "다시 시도" : "Retry"}</button></p> : <>
        {!resource.state.data.comments.length && <p className={styles.muted}>{ko ? "첫 댓글로 이야기를 시작해 보세요." : "Start the conversation with the first comment."}</p>}
        <ul className={styles.commentList}>{resource.state.data.comments.map((comment) => <li key={comment.id}><img src={comment.avatarUrl} width={32} height={32} alt="" /><div><div className={styles.commentMeta}><strong>{comment.nickname}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(comment.createdAt))}</time>{comment.isOwner && <button disabled={busy} onClick={() => void mutate(comment.id)}>{ko ? "삭제" : "Delete"}</button>}</div><p>{comment.body}</p></div></li>)}</ul>
        {!preview && <div className={styles.pagination}>{cursor && <button onClick={() => setCursor(null)}>{ko ? "최신 댓글" : "Newest"}</button>}{resource.state.data.nextCursor && <button onClick={() => { if (resource.state.status === "ready") setCursor(resource.state.data.nextCursor); }}>{ko ? "이전 댓글" : "Older comments"}</button>}</div>}
      </>}
    </div>
    {ready && authenticated ? <form className={styles.commentForm} onSubmit={(event) => { event.preventDefault(); void mutate(); }}><label htmlFor={`comment-${noticeSlug}`}>{ko ? "댓글 남기기" : "Leave a comment"}</label><textarea id={`comment-${noticeSlug}`} value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} rows={2} required disabled={busy} placeholder={ko ? "함께 나누고 싶은 이야기를 남겨 주세요." : "Share a thought with other fans."} /><div><small>{ko ? "닉네임과 캐릭터 아바타가 함께 공개돼요." : "Your nickname and character avatar are public."}</small><button type="submit" className={styles.darkButton} disabled={busy || !body.trim()}>{busy ? (ko ? "저장 중…" : "Saving…") : (ko ? "등록" : "Post")}</button></div></form> : ready ? <AuthIntentLink className={styles.loginComment} locale={locale} input={{ sourcePath: `/c/${slug}/notices/${noticeSlug}`, sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "celebrity", targetId: slug }}>{ko ? "로그인하고 댓글 남기기" : "Sign in to comment"}</AuthIntentLink> : null}
    {error && <p role="alert">{error}</p>}
  </section>;
}
