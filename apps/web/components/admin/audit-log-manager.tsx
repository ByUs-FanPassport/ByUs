"use client";

import { AlertCircle, ChevronRight, FileLock2, X } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./operations.module.css";

type AuditItem = { id: string; actor: { type: "admin" | "app_user" | "system"; id: string | null; role: "admin" | "operator" | "viewer" | null }; action: string; entity: { type: string; id: string | null }; result: string | null; summary: Record<string, unknown>; correlationId: string; createdAt: string };
const copy = {
  ko: { eyebrow: "변경 추적", title: "감사 로그", description: "관리자와 시스템의 주요 행동을 변경 불가능한 이력으로 확인합니다.", immutable: "감사 로그는 추가만 가능하며 수정하거나 삭제할 수 없습니다.", actor: "행위자 ID", entityType: "대상 유형", entityId: "대상 ID", action: "행동", result: "결과", correlation: "상관관계 ID", from: "시작 시각", to: "종료 시각", apply: "필터 적용", reset: "초기화", time: "시각", entity: "대상", detail: "로그 상세", close: "상세 닫기", loading: "감사 로그를 불러오는 중입니다.", empty: "조건에 맞는 감사 로그가 없습니다.", emptyHelp: "필터 범위를 넓히거나 초기화해 보세요.", error: "감사 로그를 불러오지 못했습니다.", again: "다시 시도", more: "이전 로그 더 보기", actorLabel: "행위자", correlationLabel: "상관관계", summary: "정제된 변경 요약", before: "변경 전", after: "변경 후", noValue: "기록된 값이 없습니다." },
  en: { eyebrow: "Change trace", title: "Audit log", description: "Review significant admin and system actions as an immutable record.", immutable: "Audit logs are append-only and cannot be edited or deleted.", actor: "Actor ID", entityType: "Entity type", entityId: "Entity ID", action: "Action", result: "Result", correlation: "Correlation ID", from: "From", to: "To", apply: "Apply filters", reset: "Reset", time: "Time", entity: "Entity", detail: "Log details", close: "Close details", loading: "Loading audit logs.", empty: "No audit logs match these filters.", emptyHelp: "Expand the range or reset the filters.", error: "Audit logs could not be loaded.", again: "Try again", more: "Load older logs", actorLabel: "Actor", correlationLabel: "Correlation", summary: "Redacted change summary", before: "Before", after: "After", noValue: "No value was recorded." },
} as const;
function localeFrom(value: string | null): AdminLocale { return value === "en" ? "en" : "ko"; }
function formatDate(value: string, locale: AdminLocale) { return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function toIso(value: FormDataEntryValue | null) { const text = String(value ?? "").trim(); return text ? new Date(text).toISOString() : ""; }

export function AuditLogManager() {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const params = useSearchParams();
  const router = useRouter();
  const locale = localeFrom(params.get("lang"));
  const t = copy[locale];
  const [items, setItems] = useState<AuditItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const request = useCallback(async (nextCursor?: string) => {
    nextCursor ? setLoadingMore(true) : setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const query = new URLSearchParams();
      ["actor", "entityType", "entityId", "action", "result", "from", "to", "correlation"].forEach((key) => { const value = params.get(key); if (value) query.set(key, value); });
      query.set("limit", "50");
      if (nextCursor) query.set("cursor", nextCursor);
      const response = await fetch(`/api/admin/audit-logs?${query}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = await response.json() as { items: AuditItem[]; nextCursor: string | null };
      setItems((current) => nextCursor ? [...current, ...body.items] : body.items);
      setCursor(body.nextCursor); setState("ready");
    } catch { if (!nextCursor) setState("error"); }
    finally { setLoadingMore(false); }
  }, [getAccessToken, params]);
  useEffect(() => { if (session.status === "authorized") void request(); }, [request, session.status]);

  function applyFilters(form: FormData) {
    const next = new URLSearchParams();
    if (locale === "en") next.set("lang", "en");
    for (const key of ["actor", "entityType", "entityId", "action", "result", "correlation"]) { const value = String(form.get(key) ?? "").trim(); if (value) next.set(key, value); }
    for (const key of ["from", "to"]) { const value = toIso(form.get(key)); if (value) next.set(key, value); }
    router.replace(`/admin/audit${next.size ? `?${next}` : ""}` as Route, { scroll: false });
  }
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  return <AdminOperationsShell locale={locale}>
    <header className={styles.pageHeading}><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.description}</span></header>
    <div className={styles.immutableNotice}><FileLock2 aria-hidden="true" /><p>{t.immutable}</p></div>
    <form className={`${styles.filterBar} ${styles.auditFilters}`} action={applyFilters}>
      <Filter name="actor" label={t.actor} value={params.get("actor")} /><Filter name="entityType" label={t.entityType} value={params.get("entityType")} /><Filter name="entityId" label={t.entityId} value={params.get("entityId")} /><Filter name="action" label={t.action} value={params.get("action")} /><Filter name="result" label={t.result} value={params.get("result")} /><Filter name="correlation" label={t.correlation} value={params.get("correlation")} />
      <Filter name="from" label={t.from} type="datetime-local" value={params.get("from")?.slice(0,16)} /><Filter name="to" label={t.to} type="datetime-local" value={params.get("to")?.slice(0,16)} />
      <div className={styles.filterActions}><button className={styles.secondaryButton} type="submit">{t.apply}</button><button className={styles.textButton} type="button" onClick={() => router.replace((locale === "en" ? "/admin/audit?lang=en" : "/admin/audit") as Route)}>{t.reset}</button></div>
    </form>
    {state === "loading" && <div className={styles.skeletonList} aria-label={t.loading}>{[1,2,3,4,5].map((n) => <div key={n} />)}</div>}
    {state === "error" && <State icon={<AlertCircle aria-hidden="true" />} title={t.error} action={<button type="button" onClick={() => void request()}>{t.again}</button>} />}
    {state === "ready" && items.length === 0 && <State icon={<FileLock2 aria-hidden="true" />} title={t.empty} body={t.emptyHelp} />}
    {state === "ready" && items.length > 0 && <><div className={styles.tableWrap}><table><thead><tr><th>{t.time}</th><th>{t.action}</th><th>{t.actorLabel}</th><th>{t.entity}</th><th>{t.result}</th><th><span className={styles.srOnly}>{t.detail}</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt, locale)}</td><td><strong>{item.action}</strong></td><td>{item.actor.type}<code>{item.actor.id ?? "—"}</code></td><td>{item.entity.type}<code>{item.entity.id ?? "—"}</code></td><td>{item.result ?? "—"}</td><td><button className={styles.iconButton} type="button" aria-label={`${t.detail}: ${item.id}`} onClick={() => setSelected(item)}><ChevronRight aria-hidden="true" /></button></td></tr>)}</tbody></table></div>{cursor && <button className={styles.loadMore} type="button" disabled={loadingMore} onClick={() => void request(cursor)}>{loadingMore ? "…" : t.more}</button>}</>}
    {selected && <><div className={styles.drawerBackdrop} onClick={() => setSelected(null)} /><aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><div className={styles.drawerHeader}><div><p>#{selected.id}</p><h2 id="audit-detail-title">{t.detail}</h2></div><button className={styles.iconButton} type="button" aria-label={t.close} onClick={() => setSelected(null)}><X aria-hidden="true" /></button></div><div className={styles.drawerBody}><dl className={styles.detailGrid}><div><dt>{t.time}</dt><dd>{formatDate(selected.createdAt, locale)}</dd></div><div><dt>{t.action}</dt><dd>{selected.action}</dd></div><div><dt>{t.actorLabel}</dt><dd>{selected.actor.type} · {selected.actor.role ?? "—"}<code>{selected.actor.id ?? "—"}</code></dd></div><div><dt>{t.entity}</dt><dd>{selected.entity.type}<code>{selected.entity.id ?? "—"}</code></dd></div><div><dt>{t.result}</dt><dd>{selected.result ?? "—"}</dd></div><div><dt>{t.correlationLabel}</dt><dd><code>{selected.correlationId}</code></dd></div></dl><section className={styles.detailSection}><h3>{t.summary}</h3><Summary summary={selected.summary} before={t.before} after={t.after} empty={t.noValue} /></section></div></aside></>}
  </AdminOperationsShell>;
}

function Filter({ name, label, value, type = "text" }: { name: string; label: string; value?: string | null; type?: string }) { return <label><span>{label}</span><input name={name} type={type} defaultValue={value ?? ""} /></label>; }
function State({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) { return <section className={styles.stateMessage}>{icon}<h2>{title}</h2>{body && <p>{body}</p>}{action}</section>; }
function Summary({ summary, before, after, empty }: { summary: Record<string, unknown>; before: string; after: string; empty: string }) {
  const beforeValue = summary.before;
  const afterValue = summary.after;
  const rest = Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "before" && key !== "after"));
  const block = (value: unknown) => value === undefined ? <p>{empty}</p> : <pre>{JSON.stringify(value, null, 2)}</pre>;
  return <div className={styles.summaryBlocks}>{(beforeValue !== undefined || afterValue !== undefined) && <><div><h4>{before}</h4>{block(beforeValue)}</div><div><h4>{after}</h4>{block(afterValue)}</div></>}{Object.keys(rest).length > 0 && <div><pre>{JSON.stringify(rest, null, 2)}</pre></div>}{Object.keys(summary).length === 0 && <p>{empty}</p>}</div>;
}
