"use client";

import { AlertCircle, ChevronRight, Clock3, RefreshCw, X } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import { AlertDialog, Drawer } from "../ui/overlay/accessible-overlay";
import styles from "./operations.module.css";

type Status = "PENDING" | "PROCESSING" | "COMPLETED" | "RETRYING" | "FAILED";
type Job = { id: string; entityType: "passport" | "stamp"; entityId: string; status: Status; attempts: number; maxAttempts: number; nextAttemptAt: string; createdAt: string; updatedAt: string; completedAt: string | null; transactionReference: string | null; chainState: "not_submitted" | "prepared_reconciliation_required" | "confirmed"; errorCode: string | null; errorSummary: string | null; manuallyRetryable: boolean; attemptHistory: Array<{ attemptNumber: number; event: string; fromStatus: Status | null; toStatus: Status; errorCode: string | null; createdAt: string; correlationId: string | null }> };

const labels = {
  ko: { eyebrow: "운영 안정성", title: "블록체인 작업", description: "발급·민팅 작업의 상태와 시도 이력을 확인하고, 안전한 조건에서만 재시도합니다.", all: "전체 상태", search: "작업 ID", apply: "필터 적용", reset: "초기화", loading: "작업 목록을 불러오는 중입니다.", empty: "조건에 맞는 작업이 없습니다.", emptyHelp: "필터를 초기화하거나 다른 상태를 선택해 보세요.", error: "작업 목록을 불러오지 못했습니다.", again: "다시 시도", detail: "작업 상세", close: "상세 닫기", entity: "대상", attempts: "시도", chain: "체인 상태", created: "생성", updated: "최근 변경", completed: "완료", transaction: "안전한 트랜잭션 참조", noTransaction: "아직 제출된 트랜잭션이 없습니다.", errorLabel: "정제된 오류", noError: "표시할 안전한 오류 정보가 없습니다.", history: "시도 이력", retry: "재시도 요청", retryUnavailable: "현재 상태에서는 재시도할 수 없습니다.", viewer: "Viewer 역할은 조회만 가능합니다.", confirmTitle: "이 작업을 재시도할까요?", confirmBody: "현재 작업의 안전 상태를 다시 검증한 뒤 큐에 넣습니다. 기존 시도 이력은 변경되지 않습니다.", cancel: "취소", confirm: "재시도", retryError: "재시도 요청을 처리하지 못했습니다.", loadMore: "이전 작업 더 보기" },
  en: { eyebrow: "Operational reliability", title: "Blockchain jobs", description: "Review issuance and minting status, attempt history, and retry only when safe.", all: "All statuses", search: "Job ID", apply: "Apply filters", reset: "Reset", loading: "Loading blockchain jobs.", empty: "No jobs match these filters.", emptyHelp: "Reset the filters or select another status.", error: "Blockchain jobs could not be loaded.", again: "Try again", detail: "Job details", close: "Close details", entity: "Entity", attempts: "Attempts", chain: "Chain state", created: "Created", updated: "Last updated", completed: "Completed", transaction: "Safe transaction reference", noTransaction: "No transaction has been submitted yet.", errorLabel: "Redacted error", noError: "No safe error details are available.", history: "Attempt history", retry: "Request retry", retryUnavailable: "This job is not eligible for retry.", viewer: "Viewer role is read-only.", confirmTitle: "Retry this job?", confirmBody: "The server will re-check its safe state before queueing it. Existing attempt history remains immutable.", cancel: "Cancel", confirm: "Retry", retryError: "The retry request could not be processed.", loadMore: "Load older jobs" },
} as const;

function localeFrom(value: string | null): AdminLocale { return value === "en" ? "en" : "ko"; }
function date(value: string | null, locale: AdminLocale) { return value ? new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }

export function BlockchainJobsManager() {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const params = useSearchParams();
  const router = useRouter();
  const locale = localeFrom(params.get("lang"));
  const t = labels[locale];
  const status = params.get("status") as Status | null;
  const jobId = params.get("jobId") ?? "";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retrying, setRetrying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [retryError, setRetryError] = useState(false);

  const fetchJobs = useCallback(async () => {
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const query = new URLSearchParams({ limit: "50" });
      if (status) query.set("status", status);
      if (jobId) query.set("jobId", jobId);
      const response = await fetch(`/api/admin/blockchain-jobs?${query}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = await response.json() as { jobs?: Job[]; job?: Job };
      setJobs(body.job ? [body.job] : body.jobs ?? []);
      setState("ready");
    } catch { setState("error"); }
  }, [getAccessToken, jobId, status]);

  useEffect(() => { if (session.status === "authorized") void fetchJobs(); }, [fetchJobs, session.status]);
  const canRetry = selected?.manuallyRetryable && session.status === "authorized" && session.admin.role !== "viewer";
  const statusOptions = useMemo(() => ["PENDING", "PROCESSING", "RETRYING", "FAILED", "COMPLETED"] as const, []);

  function applyFilters(form: FormData) {
    const next = new URLSearchParams();
    if (locale === "en") next.set("lang", "en");
    const nextStatus = String(form.get("status") ?? "");
    const nextId = String(form.get("jobId") ?? "").trim();
    if (nextStatus) next.set("status", nextStatus);
    if (nextId) next.set("jobId", nextId);
    router.replace(`/admin/blockchain-jobs${next.size ? `?${next}` : ""}` as Route, { scroll: false });
  }

  async function retry() {
    if (!selected || !canRetry) return;
    setRetrying(true); setRetryError(false);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const response = await fetch(`/api/admin/blockchain-jobs/${selected.id}/retry`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-correlation-id": crypto.randomUUID() } });
      if (!response.ok) throw new Error("retry failed");
      setConfirming(false); setSelected(null); await fetchJobs();
    } catch { setRetryError(true); }
    finally { setRetrying(false); }
  }

  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  return <AdminOperationsShell locale={locale}>
    <header className={styles.pageHeading}><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.description}</span></header>
    <form className={styles.filterBar} action={applyFilters}>
      <label><span>{locale === "ko" ? "상태" : "Status"}</span><select key={status ?? "all"} name="status" defaultValue={status ?? ""}><option value="">{t.all}</option>{statusOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={styles.growField}><span>{t.search}</span><input key={jobId || "all"} name="jobId" defaultValue={jobId} placeholder="00000000-0000-0000-0000-000000000000" /></label>
      <button className={styles.secondaryButton} type="submit">{t.apply}</button>
      <button className={styles.textButton} type="button" onClick={() => router.replace((locale === "en" ? "/admin/blockchain-jobs?lang=en" : "/admin/blockchain-jobs") as Route)}>{t.reset}</button>
    </form>
    {state === "loading" && <div className={styles.skeletonList} aria-label={t.loading}>{[1,2,3,4,5].map((n) => <div key={n} />)}</div>}
    {state === "error" && <StateMessage icon={<AlertCircle aria-hidden="true" />} title={t.error} action={<button type="button" onClick={() => void fetchJobs()}>{t.again}</button>} />}
    {state === "ready" && jobs.length === 0 && <StateMessage icon={<Clock3 aria-hidden="true" />} title={t.empty} body={t.emptyHelp} />}
    {state === "ready" && jobs.length > 0 && <div className={styles.tableWrap}><table><thead><tr><th>{locale === "ko" ? "상태" : "Status"}</th><th>{t.entity}</th><th>{t.attempts}</th><th>{t.updated}</th><th><span className={styles.srOnly}>{t.detail}</span></th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><StatusBadge status={job.status} /></td><td><strong>{job.entityType}</strong><code>{job.entityId}</code></td><td>{job.attempts} / {job.maxAttempts}</td><td>{date(job.updatedAt, locale)}</td><td><button className={styles.iconButton} type="button" aria-label={`${t.detail}: ${job.id}`} onClick={() => setSelected(job)}><ChevronRight aria-hidden="true" /></button></td></tr>)}</tbody></table></div>}
    {selected && <Drawer open onClose={() => setSelected(null)} labelledBy="job-detail-title" backdropClassName={styles.drawerBackdrop} contentClassName={styles.drawer}><div className={styles.drawerHeader}><div><p>{selected.id}</p><h2 id="job-detail-title">{t.detail}</h2></div><button className={styles.iconButton} type="button" aria-label={t.close} data-autofocus onClick={() => setSelected(null)}><X aria-hidden="true" /></button></div><div className={styles.drawerBody}>
      <StatusBadge status={selected.status} />
      <dl className={styles.detailGrid}><div><dt>{t.entity}</dt><dd>{selected.entityType}<code>{selected.entityId}</code></dd></div><div><dt>{t.attempts}</dt><dd>{selected.attempts} / {selected.maxAttempts}</dd></div><div><dt>{t.chain}</dt><dd>{selected.chainState}</dd></div><div><dt>{t.created}</dt><dd>{date(selected.createdAt, locale)}</dd></div><div><dt>{t.updated}</dt><dd>{date(selected.updatedAt, locale)}</dd></div><div><dt>{t.completed}</dt><dd>{date(selected.completedAt, locale)}</dd></div></dl>
      <section className={styles.detailSection}><h3>{t.transaction}</h3>{selected.transactionReference ? <code className={styles.codeBlock}>{selected.transactionReference}</code> : <p>{t.noTransaction}</p>}</section>
      <section className={styles.detailSection}><h3>{t.errorLabel}</h3>{selected.errorSummary || selected.errorCode ? <div className={styles.errorBox}><strong>{selected.errorCode}</strong><p>{selected.errorSummary}</p></div> : <p>{t.noError}</p>}</section>
      <section className={styles.detailSection}><h3>{t.history}</h3><ol className={styles.timeline}>{selected.attemptHistory.map((attempt) => <li key={`${attempt.attemptNumber}-${attempt.createdAt}`}><div><strong>#{attempt.attemptNumber} · {attempt.event}</strong><span>{date(attempt.createdAt, locale)}</span></div><p>{attempt.fromStatus ? `${attempt.fromStatus} → ` : ""}{attempt.toStatus}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</p></li>)}</ol></section>
    </div><footer className={styles.drawerFooter}>{session.admin.role === "viewer" && <p>{t.viewer}</p>}{!canRetry && session.admin.role !== "viewer" && <p>{t.retryUnavailable}</p>}<button className={styles.primaryButton} type="button" disabled={!canRetry} onClick={() => setConfirming(true)}><RefreshCw aria-hidden="true" />{t.retry}</button></footer></Drawer>}
    {confirming && <AlertDialog open onClose={() => setConfirming(false)} labelledBy="retry-title" describedBy="retry-description" backdropClassName={styles.confirmBackdrop} contentClassName={styles.confirmDialog} busy={retrying}><h2 id="retry-title">{t.confirmTitle}</h2><p id="retry-description">{t.confirmBody}</p>{retryError && <p className={styles.inlineError} role="alert">{t.retryError}</p>}<div><button className={styles.secondaryButton} type="button" data-autofocus disabled={retrying} onClick={() => setConfirming(false)}>{t.cancel}</button><button className={styles.dangerButton} type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "…" : t.confirm}</button></div></AlertDialog>}
  </AdminOperationsShell>;
}

function StatusBadge({ status }: { status: Status }) { return <span className={`${styles.statusBadge} ${styles[`status${status}`]}`}>{status}</span>; }
function StateMessage({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) { return <section className={styles.stateMessage}>{icon}<h2>{title}</h2>{body && <p>{body}</p>}{action}</section>; }
