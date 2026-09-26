"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { reportPageSchema } from "@/features/fan-posts/domain/content";
import { useContentMutation } from "@/features/content-safety/ui/use-content-mutation";
import { useOwnedFanResource } from "../fan-ui/use-owned-fan-resource";
import { useAdminSession } from "./use-admin-session";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell } from "./operations-shell";
import styles from "./operations.module.css";
import listStyles from "./notice-comment-manager.module.css";

const parse = (value: unknown) => reportPageSchema.parse(value);
const targetLabels = { fan_post: "팬 게시글", fan_post_comment: "팬 게시글 댓글", notice: "공식 소식", notice_comment: "공식 소식 댓글", cheer: "응원글", live_submission: "LIVE 질문·응원" } as const;
export function ContentReportManager() {
  const auth = usePrivy();
  return <ReportsForOwner key={auth.user?.id ?? "guest"} />;
}
function ReportsForOwner() {
  const auth = usePrivy(), session = useAdminSession(), mutation = useContentMutation("ko");
  const [status, setStatus] = useState("open"), [cursors, setCursors] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null), [reason, setReason] = useState("");
  const [resolution, setResolution] = useState<"resolved" | "dismissed">("resolved"), [hideTarget, setHideTarget] = useState(false);
  const cursor = cursors.at(-1);
  const resource = useOwnedFanResource(session.status === "authorized" ? `/api/admin/content-reports?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` : null, parse, auth);
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale="ko" />;
  const busy = mutation.busy || resource.state.status === "loading";
  function clear() { setSelected(null); setReason(""); setResolution("resolved"); setHideTarget(false); }
  async function resolve() {
    if (!selected) return;
    if (await mutation.request(`/api/admin/content-reports/${selected}`, "PATCH", { resolution, hideTarget: resolution === "resolved" && hideTarget, reason })) { clear(); resource.retry(); }
  }
  function nextPage() {
    if (resource.state.status !== "ready") return;
    const next = resource.state.data.nextCursor;
    if (next) { clear(); setCursors(value => [...value, next]); }
  }
  return <AdminOperationsShell locale="ko" adminRole={session.admin.role}>
    <header className={styles.pageHeading}><p>커뮤니티 운영</p><h1>콘텐츠 신고</h1><span>신고 내용을 확인하고 처리 사유를 남깁니다.</span></header>
    <label className={listStyles.filters}>처리 상태 <select value={status} disabled={busy} onChange={event => { clear(); setStatus(event.target.value); setCursors([]); }}><option value="open">미처리</option><option value="resolved">처리 완료</option><option value="dismissed">반려</option></select></label>
    {resource.state.status === "loading" ? <p role="status">신고를 불러오고 있습니다.</p> : resource.state.status === "error" ? <p role="alert">신고를 불러오지 못했습니다. <button type="button" onClick={resource.retry}>다시 시도</button></p> : <div className={listStyles.list}>
      {resource.state.data.items.length === 0 && <p>이 상태의 신고가 없습니다.</p>}
      {resource.state.data.items.map(report => <article className={listStyles.card} key={report.id}>
        <header><strong>{report.target?.celebritySlug ?? "삭제된 콘텐츠"}</strong><time dateTime={report.createdAt}>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(report.createdAt))}</time></header>
        <p><strong>{targetLabels[report.targetType]}</strong> · 버전 {report.targetRevision}</p>
        <p>대상 ID: <code style={{ overflowWrap: "anywhere" }}>{report.targetId}</code>{report.targetType === "fan_post" && report.target && <> · <a href={`/c/${encodeURIComponent(report.target.celebritySlug)}/community/${report.targetId}?locale=ko`} target="_blank" rel="noopener noreferrer">원문 보기, 새 창</a></>}</p>
        <p>{report.target?.body ?? "현재 표시할 수 없는 콘텐츠입니다."}</p><p><strong>신고 사유</strong> · {report.reason}</p>
        {status === "open" && session.admin.role !== "viewer" && <button type="button" disabled={busy} onClick={() => { clear(); setSelected(report.id); }}>신고 처리</button>}
        {selected === report.id && <form onSubmit={event => { event.preventDefault(); void resolve(); }}>
          <label>처리 결과 <select value={resolution} disabled={busy} onChange={event => { setResolution(event.target.value as "resolved" | "dismissed"); setHideTarget(false); }}><option value="resolved">처리 완료</option><option value="dismissed">반려</option></select></label>
          {resolution === "resolved" && <label><input type="checkbox" checked={hideTarget} disabled={busy} onChange={event => setHideTarget(event.target.checked)} />위 {targetLabels[report.targetType]} 숨김</label>}
          <label htmlFor="report-resolution-reason">처리 사유 (10자 이상)</label><textarea id="report-resolution-reason" minLength={10} maxLength={500} required value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
          <div><button type="button" disabled={busy} onClick={clear}>취소</button><button type="submit" disabled={busy || reason.trim().length < 10}>{busy ? "저장 중…" : "처리 저장"}</button></div>
        </form>}
      </article>)}
      <nav className={listStyles.pagination} aria-label="신고 페이지 이동"><button type="button" disabled={busy || cursors.length === 0} onClick={() => { clear(); setCursors(value => value.slice(0, -1)); }}>이전 페이지</button>{resource.state.data.nextCursor && <button type="button" disabled={busy} onClick={nextPage}>다음 페이지</button>}</nav>
    </div>}
    {mutation.error && <p role="alert">{mutation.error}</p>}
  </AdminOperationsShell>;
}
