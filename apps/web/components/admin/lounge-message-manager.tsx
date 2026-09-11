"use client";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { useOwnedFanResource } from "../fan-ui/use-owned-fan-resource";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./operations.module.css";
import commentStyles from "./notice-comment-manager.module.css";
const parse = (value: unknown) => z.object({ messages: z.array(z.object({ id: z.string(), body: z.string(), nickname: z.string(), celebritySlug: z.string(), createdAt: z.string() }))  , nextCursor: z.string().nullable() }).parse(value);
export function LoungeMessageManager() {
  const auth = usePrivy();
  return <ManagerForOwner key={`${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}`} />;
}
function ManagerForOwner() {
  const auth = usePrivy();
  const session = useAdminSession();
  const [before, setBefore] = useState<string | null>(null);
  const resource = useOwnedFanResource(session.status === "authorized" ? `/api/admin/lounge-messages${before ? `?cursor=${encodeURIComponent(before)}` : ""}` : null, parse, auth);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale="ko" />;
  async function hide() {
    if (!selected || !reason.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error();
      const response = await fetch(`/api/admin/lounge-messages/${selected}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      if (!response.ok) throw new Error();
      setSelected(null); setReason(""); setMessage("메시지를 숨겼습니다."); resource.retry();
    } catch { setMessage("메시지를 숨기지 못했습니다. 권한과 연결을 확인해 주세요."); }
    finally { setBusy(false); }
  }
  return <AdminOperationsShell locale="ko" adminRole={session.admin.role}><header className={styles.pageHeading}><p>커뮤니티 운영</p><h1>팬 라운지</h1><span>공개 메시지를 확인하고 사유를 남겨 숨길 수 있습니다.</span></header>
    {resource.state.status === "loading" ? <p role="status">메시지를 불러오고 있습니다.</p> : resource.state.status === "error" ? <button onClick={resource.retry}>다시 시도</button> : <><div className={commentStyles.list}>{!resource.state.data.messages.length && <p>공개 메시지가 없습니다.</p>}{resource.state.data.messages.map((comment) => <article key={comment.id} className={commentStyles.card}><header><strong>{comment.nickname}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(comment.createdAt))}</time></header><Link href={`/c/${comment.celebritySlug}/lounge?locale=ko`}>{comment.celebritySlug} · 라운지 보기 →</Link><p>{comment.body}</p>{session.admin.role !== "viewer" && <button disabled={busy} onClick={() => { setSelected(comment.id); setReason(""); }}>숨김 사유 입력</button>}{selected === comment.id && <form onSubmit={(event) => { event.preventDefault(); void hide(); }}><label htmlFor="comment-removal-reason">숨김 사유</label><textarea id="comment-removal-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required disabled={busy} /><div><button type="button" disabled={busy} onClick={() => setSelected(null)}>취소</button><button type="submit" disabled={busy || !reason.trim()}>{busy ? "저장 중…" : "메시지 숨기기"}</button></div></form>}</article>)}</div><div className={commentStyles.pagination}>{before && <button onClick={() => setBefore(null)}>최신 메시지</button>}{resource.state.data.nextCursor && <button onClick={() => { if (resource.state.status === "ready") setBefore(resource.state.data.nextCursor); }}>이전 메시지</button>}</div></>}
    {message && <p role="status">{message}</p>}
  </AdminOperationsShell>;
}
