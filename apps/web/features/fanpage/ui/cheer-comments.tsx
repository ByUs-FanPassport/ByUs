"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Heart } from "lucide-react";
import { cheerPageSchema } from "../domain/fan-community";
import { useCommunityResource } from "./use-community-resource";
import styles from "./fan-community.module.css";

const parse = (value: unknown) => cheerPageSchema.parse(value);
export function CheerComments({ slug, name, locale }: { slug: string; name: string; locale: "ko" | "en" }) {
  const auth = usePrivy();
  return <CommentsForOwner key={`${slug}:${locale}:${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}`} {...{ slug, name, locale }} />;
}
function CommentsForOwner({ slug, name, locale }: { slug: string; name: string; locale: "ko" | "en" }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const ko = locale === "ko";
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useCommunityResource(`/api/celebrities/${slug}/cheers?locale=${locale}&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, parse);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current?.abort(); };
  }, []);
  async function mutate(id?: string) {
    if (pending.current || !ready || !authenticated || (!id && !body.trim())) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError("");
    try {
      const token = await getAccessToken();
      if (!alive.current || controller.signal.aborted) return;
      if (!token) throw new Error();
      const text = body.trim();
      if (!id && (!attempt.current || attempt.current.body !== text)) attempt.current = { body: text, key: crypto.randomUUID() };
      const response = await fetch(id ? `/api/cheers/${id}` : `/api/celebrities/${slug}/cheers?locale=${locale}`, {
        method: id ? "DELETE" : "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: id ? undefined : JSON.stringify({ body: text, idempotencyKey: attempt.current!.key }),
      });
      if (!alive.current || controller.signal.aborted) return;
      if (!response.ok) {
        setError(response.status === 429 ? (ko ? "잠시 후 다시 응원을 남겨 주세요." : "Please wait before posting another cheer.") : (ko ? "저장하지 못했어요. 다시 시도해 주세요." : "Couldn't save. Please try again."));
        return;
      }
      if (!id) { setBody(""); attempt.current = null; }
      setCursor(null); resource.retry();
    } catch {
      if (alive.current && !controller.signal.aborted) setError(ko ? "연결을 확인하고 다시 시도해 주세요." : "Check your connection and try again.");
    } finally {
      if (alive.current && !controller.signal.aborted) { pending.current = null; setBusy(false); }
    }
  }
  const data = resource.state.status === "ready" ? resource.state.data : null;
  const returnTo = `/c/${slug}?locale=${locale}#cheers`;
  return <section id="cheers" className={styles.cheers} aria-labelledby="cheers-heading">
    <header className={styles.heading}><Heart aria-hidden="true" /><h2 id="cheers-heading">{ko ? "응원댓글" : "Cheers"}</h2>{data && <span>{data.total.toLocaleString(ko ? "ko-KR" : "en-US")}</span>}</header>
    <p className={styles.intro}>{ko ? `${name}에게 응원의 한마디를 남겨 주세요.` : `Leave a little encouragement for ${name}.`}</p>
    {ready && authenticated ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void mutate(); }}>
      <label htmlFor="cheer-body">{ko ? "응원 남기기" : "Leave a cheer"}</label>
      <textarea id="cheer-body" rows={2} maxLength={1000} required disabled={busy} value={body} onChange={event => setBody(event.target.value)} placeholder={ko ? "좋아하는 마음을 전해 보세요." : "Share what you appreciate."} aria-describedby={`cheer-note${error ? " cheer-error" : ""}`} />
      <div><small id="cheer-note">{ko ? "닉네임과 캐릭터가 함께 공개돼요." : "Your nickname and character are public."}</small><button type="submit" className={styles.submit} disabled={busy || !body.trim()}>{busy ? (ko ? "저장 중…" : "Saving…") : (ko ? "응원 보내기" : "Post cheer")}</button></div>
    </form> : ready ? <Link className={styles.signIn} href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}` as Route}>{ko ? "로그인하고 응원 남기기" : "Sign in to leave a cheer"}</Link> : null}
    {error && <p id="cheer-error" className={styles.error} role="alert">{error}</p>}
    {!data ? <p className={styles.status} role={resource.state.status === "error" ? "alert" : "status"}>{resource.state.status === "error" ? (ko ? "응원댓글을 불러오지 못했어요." : "Couldn't load cheers.") : (ko ? "응원댓글을 불러오고 있어요." : "Loading cheers.")}{resource.state.status === "error" && <button onClick={resource.retry}>{ko ? "다시 시도" : "Retry"}</button>}</p> : <>
      {data.comments.length === 0 ? <p className={styles.empty}>{ko ? "첫 응원을 남겨 주세요." : "Be the first to leave a cheer."}</p> : <ul className={styles.commentList}>
        {data.comments.map(comment => <li key={comment.id} data-cheer-id={comment.id}><img src={comment.avatarUrl} alt="" width={32} height={32} /><div>
          <div className={styles.meta}><strong>{comment.nickname}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(comment.createdAt))}</time>{comment.isOwner && <button disabled={busy} aria-label={ko ? "내 응원댓글 삭제" : "Delete my cheer"} onClick={() => void mutate(comment.id)}>{ko ? "삭제" : "Delete"}</button>}</div>
          <p>{comment.body}</p>
        </div></li>)}
      </ul>}
      {(cursor || data.nextCursor) && <div className={styles.pagination}>{cursor && <button onClick={() => setCursor(null)}>{ko ? "최신 응원" : "Newest cheers"}</button>}{data.nextCursor && <button onClick={() => setCursor(data.nextCursor)}>{ko ? "이전 응원 보기" : "Older cheers"}</button>}</div>}
      {resource.refreshFailed && <p className={styles.status}>{ko ? "응원댓글을 갱신하지 못했어요." : "Couldn't refresh cheers."}<button onClick={resource.retry}>{ko ? "다시 시도" : "Retry"}</button></p>}
    </>}
  </section>;
}
