"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AdminAccessState } from "../../../components/admin/admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import { BANKSY_LANDING, campaignAdminDataSchema, type CampaignAdminData, type CampaignCommand } from "../domain/banksy-campaign";
import base from "./admin-overview-dashboard.module.css";
import styles from "./banksy-campaign-dashboard.module.css";

type Days = 7 | 30 | 90;
type State = { status: "loading" } | { status: "ready"; owner: string; days: Days; data: CampaignAdminData }
  | { status: "error" } | { status: "unauthenticated" | "denied" };
type Draft = Extract<CampaignCommand, { action: "create" }>;

const channels = ["instagram", "tiktok", "youtube", "facebook", "x", "mirrorworld", "other"] as const;
const contentTypes = ["story", "reel", "video", "post", "bio", "other"] as const;
const freshId = () => crypto.randomUUID();
const format = (value: number, locale: AdminLocale) => new Intl.NumberFormat(locale).format(value);
const rate = (sessions: number, visits: number, locale: AdminLocale) => visits === 0 ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(sessions / visits);
const date = (value: string, locale: AdminLocale) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));

const copy = {
  ko: {
    eyebrow: "BYUS · CAMPAIGN TRACKING", title: "뱅크시 캠페인", description: "공유 링크를 만들고 응모 페이지 방문과 외부 이동을 확인하세요.", refresh: "새로고침",
    periods: { 7: "최근 7일", 30: "최근 30일", 90: "최근 90일" }, create: "공유 링크 만들기", createHelp: "링크는 기존 엘리나 경품 응모 페이지로 연결됩니다.",
    creator: "크리에이터", channel: "채널", contentType: "콘텐츠 유형", name: "링크 이름", locale: "랜딩 언어", ko: "한국어", en: "English", submit: "링크 생성", saving: "저장 중…",
    viewer: "뷰어 권한은 링크와 통계를 조회할 수 있지만 링크를 만들거나 중지할 수 없습니다.", links: "공유 링크", linkHelp: "중지한 링크도 응모 페이지로 열리지만 유입 집계에서는 제외됩니다.", noLinks: "아직 만든 공유 링크가 없습니다.",
    active: "사용 중", stopped: "중지됨", stop: "중지", stopping: "중지 중…", copy: "링크 복사", copied: "복사됨", copyFailed: "복사 실패", open: "열기", created: "생성", createFailed: "링크를 만들지 못했습니다. 같은 요청으로 다시 시도할 수 있습니다.", stopFailed: "링크를 중지하지 못했습니다.",
    analytics: "캠페인 성과", analyticsHelp: "선택 기간의 응모 페이지 방문과 같은 브라우저 세션의 외부 이동을 집계합니다.", visits: "방문", sessions: "외부 이동 세션", conversion: "이동률", source: "유입 링크", direct: "링크 없음 / 직접 방문", destination: "목적지", requests: "이동 요청", destinationSessions: "고유 세션", exhibition: "전시 예매", goods: "굿즈 구매", noSources: "이 기간에 기록된 방문이 없습니다.", noDestinations: "이 기간에 기록된 외부 이동이 없습니다.",
    caveat: "목적지별 수치는 선택 기간의 이동 기준입니다. 반복 클릭은 요청 여러 건, 세션 한 건이며 목적지 간 세션 수는 중복될 수 있습니다.", mirrorworldLegacy: "Mirrorworld 기존 경유 요청", legacy: "Instagram 기존 경유 요청", legacyHelp: "방문 세션과 연결되지 않아 이동률 계산에는 포함하지 않습니다.", loadFailed: "캠페인 데이터를 불러오지 못했습니다.", retry: "다시 시도", landing: "기존 응모 페이지",
  },
  en: {
    eyebrow: "BYUS · CAMPAIGN TRACKING", title: "Banksy campaign", description: "Create share links and measure visits to the raffle page and outbound sessions.", refresh: "Refresh",
    periods: { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days" }, create: "Create share link", createHelp: "Links open the existing Elina raffle page.",
    creator: "Creator", channel: "Channel", contentType: "Content type", name: "Link name", locale: "Landing language", ko: "Korean", en: "English", submit: "Create link", saving: "Saving…",
    viewer: "Viewers can see links and analytics, but cannot create or stop links.", links: "Share links", linkHelp: "Stopped links still open the raffle page, but no longer attribute visits.", noLinks: "No share links have been created yet.",
    active: "Active", stopped: "Stopped", stop: "Stop", stopping: "Stopping…", copy: "Copy link", copied: "Copied", copyFailed: "Copy failed", open: "Open", created: "Created", createFailed: "The link could not be created. You can retry the same request.", stopFailed: "The link could not be stopped.",
    analytics: "Campaign performance", analyticsHelp: "Visits to the raffle page in this period and outbound activity in the same browser session are counted.", visits: "Visits", sessions: "Outbound sessions", conversion: "Outbound rate", source: "Source link", direct: "No link / direct visit", destination: "Destination", requests: "Requests", destinationSessions: "Unique sessions", exhibition: "Exhibition booking", goods: "Goods purchase", noSources: "No visits were recorded in this period.", noDestinations: "No outbound activity was recorded in this period.",
    caveat: "Destination counts use outbound activity in the selected period. Repeated clicks count as multiple requests but one session; sessions can overlap between destinations.", mirrorworldLegacy: "Legacy Mirrorworld requests", legacy: "Legacy Instagram requests", legacyHelp: "These are not tied to a visit session and are excluded from the outbound rate.", loadFailed: "Campaign data could not be loaded.", retry: "Try again", landing: "Existing raffle page",
  },
} as const;

export function BanksyCampaignContent({ data, locale = "ko", canWrite = false, busyId, copyState, onStop, onCopy }: {
  data: CampaignAdminData; locale?: AdminLocale; canWrite?: boolean; busyId?: string | null;
  copyState?: { id: string; ok: boolean } | null; onStop?: (id: string) => void; onCopy?: (id: string) => void;
}) {
  const t = copy[locale];
  const names = new Map(data.links.map((link) => [link.id, link.name]));
  return <div className={styles.sections}>
    <section className={base.panel} aria-labelledby="campaign-links-title">
      <div className={base.panelHeading}><div><h2 id="campaign-links-title">{t.links}</h2><p>{t.linkHelp}</p></div><Link className={styles.landingLink} href={BANKSY_LANDING} target="_blank">{t.landing}<ExternalLink aria-hidden="true" /></Link></div>
      {data.links.length === 0 ? <p className={styles.empty}>{t.noLinks}</p> : <ul className={styles.linkList}>{data.links.map((link) => {
        const href = `https://byus.kr/t/${link.id}`;
        return <li key={link.id} className={!link.active ? styles.inactive : undefined}>
          <div className={styles.linkInfo}><div><strong>{link.name}</strong><span className={link.active ? styles.activeBadge : styles.stoppedBadge}>{link.active ? t.active : t.stopped}</span></div><p>{link.creator} · {link.channel} · {link.contentType} · {link.locale}</p><a href={href} target="_blank" rel="noreferrer">{href}</a><small>{t.created} {date(link.createdAt, locale)}</small></div>
          <div className={styles.rowActions}><button type="button" onClick={() => onCopy?.(link.id)}><Copy aria-hidden="true" />{copyState?.id === link.id ? copyState.ok ? t.copied : t.copyFailed : t.copy}</button>{canWrite && link.active && <button className={styles.stopButton} type="button" disabled={busyId === link.id} onClick={() => onStop?.(link.id)}>{busyId === link.id ? t.stopping : t.stop}</button>}</div>
        </li>;
      })}</ul>}
    </section>
    <section className={base.panel} aria-labelledby="campaign-analytics-title">
      <div className={base.panelHeading}><div><h2 id="campaign-analytics-title">{t.analytics}</h2><p>{t.analyticsHelp}</p></div><p className={styles.window}>{date(data.report.from, locale)} – {date(data.report.to, locale)}</p></div>
      <div className={styles.metrics}><div><span>{t.visits}</span><strong>{format(data.report.totals.visits, locale)}</strong></div><div><span>{t.sessions}</span><strong>{format(data.report.totals.outboundSessions, locale)}</strong></div><div><span>{t.conversion}</span><strong>{rate(data.report.totals.outboundSessions, data.report.totals.visits, locale)}</strong></div></div>
      <div className={styles.tables}>
        <div><h3>{t.source}</h3>{data.report.sources.length === 0 ? <p className={styles.empty}>{t.noSources}</p> : <div className={styles.tableScroll} tabIndex={0}><table><thead><tr><th scope="col">{t.source}</th><th scope="col">{t.visits}</th><th scope="col">{t.sessions}</th><th scope="col">{t.conversion}</th></tr></thead><tbody>{data.report.sources.map((row) => <tr key={row.linkId ?? "direct"}><th scope="row">{row.linkId ? names.get(row.linkId) ?? row.linkId : t.direct}</th><td>{format(row.visits, locale)}</td><td>{format(row.outboundSessions, locale)}</td><td>{rate(row.outboundSessions, row.visits, locale)}</td></tr>)}</tbody></table></div>}</div>
        <div><h3>{t.destination}</h3>{data.report.destinations.length === 0 ? <p className={styles.empty}>{t.noDestinations}</p> : <div className={styles.tableScroll} tabIndex={0}><table><thead><tr><th scope="col">{t.destination}</th><th scope="col">{t.requests}</th><th scope="col">{t.destinationSessions}</th></tr></thead><tbody>{data.report.destinations.map((row) => <tr key={row.destination}><th scope="row">{t[row.destination]}</th><td>{format(row.requests, locale)}</td><td>{format(row.sessions, locale)}</td></tr>)}</tbody></table></div>}<p className={styles.caveat}>{t.caveat}</p></div>
      </div>
      <div className={styles.legacy}><div><span>{t.legacy}</span><small>{t.legacyHelp}</small></div><strong>{format(data.report.legacyRequests, locale)}</strong></div>
      <div className={styles.legacy}><div><span>{t.mirrorworldLegacy}</span><small>{t.legacyHelp}</small></div><strong>{format(data.report.mirrorworldLegacyRequests, locale)}</strong></div>
    </section>
  </div>;
}

export function BanksyCampaignDashboard({ locale = "ko" }: { locale?: AdminLocale }) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const [days, setDays] = useState<Days>(7);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>(() => ({ action: "create", id: freshId(), creator: "elina", channel: "instagram", contentType: "story", name: "", locale: "ko" }));
  const [busy, setBusy] = useState<{ id: string; owner: string } | null>(null);
  const [actionError, setActionError] = useState<{ action: "create" | "stop"; owner: string } | null>(null);
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const owner = session.status === "authorized" ? session.admin.email : null;
  const ownerRef = useRef(owner);
  const t = copy[locale];
  const canWrite = session.status === "authorized" && session.admin.role !== "viewer";
  const busyId = busy?.owner === owner ? busy.id : null;
  const visibleActionError = actionError?.owner === owner ? actionError.action : null;

  useEffect(() => {
    ownerRef.current = owner;
    return () => mutation.current?.abort();
  }, [owner]);
  useEffect(() => {
    if (session.status !== "authorized") return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (controller.signal.aborted) return;
        if (!token) { setState({ status: "unauthenticated" }); return; }
        const response = await fetch(`/api/admin/campaigns/banksy?days=${days}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setState({ status: response.status === 401 ? "unauthenticated" : "denied" }); return; }
        if (!response.ok) { setState({ status: "error" }); return; }
        const data = campaignAdminDataSchema.parse(await response.json());
        if (!controller.signal.aborted) setState({ status: "ready", owner: owner ?? "", days, data });
      } catch { if (!controller.signal.aborted) setState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [session.status, owner, getAccessToken, days, refresh]);

  function change<K extends keyof Pick<Draft, "creator" | "channel" | "contentType" | "name" | "locale">>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value, id: freshId() })); setActionError(null);
  }
  async function command(value: CampaignCommand) {
    if (!owner || !canWrite) return false;
    mutation.current?.abort(); const controller = new AbortController(); mutation.current = controller;
    setBusy({ id: value.id, owner }); setActionError(null);
    try {
      const token = await getAccessToken();
      if (!token || controller.signal.aborted || ownerRef.current !== owner) return false;
      const response = await fetch("/api/admin/campaigns/banksy", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(value), signal: controller.signal });
      if (controller.signal.aborted || ownerRef.current !== owner) return false;
      if (!response.ok) { setActionError({ action: value.action, owner }); return false; }
      setRefresh((current) => current + 1); return true;
    } catch { if (!controller.signal.aborted && ownerRef.current === owner) setActionError({ action: value.action, owner }); return false; }
    finally { if (!controller.signal.aborted && ownerRef.current === owner) setBusy(null); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (await command(draft)) setDraft((current) => ({ ...current, id: freshId(), name: "" }));
  }
  async function copyLink(id: string) {
    try { await navigator.clipboard.writeText(`https://byus.kr/t/${id}`); setCopyState({ id, ok: true }); }
    catch { setCopyState({ id, ok: false }); }
  }

  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  if (state.status === "unauthenticated" || state.status === "denied") return <AdminAccessState status={state.status} locale={locale} />;
  const visible: State = state.status === "ready" && (state.owner !== owner || state.days !== days) ? { status: "loading" } : state;
  return <AdminOperationsShell locale={locale} adminRole={session.admin.role}><div className={`${base.dashboard} ${styles.dashboard}`}>
    <header className={base.header}><div><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.description}</span></div><button className={base.refresh} type="button" disabled={visible.status === "loading"} onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" />{t.refresh}</button></header>
    <div className={base.toolbar}><div className={base.segmented} role="group" aria-label={t.analytics}>{([7, 30, 90] as const).map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{t.periods[value]}</button>)}</div></div>
    {canWrite ? <section className={`${base.panel} ${styles.createPanel}`} aria-labelledby="create-campaign-link"><div className={base.panelHeading}><div><h2 id="create-campaign-link">{t.create}</h2><p>{t.createHelp}</p></div></div><form onSubmit={create}>
      <label><span>{t.creator}</span><select value={draft.creator} disabled={busyId !== null} onChange={(event) => change("creator", event.target.value as Draft["creator"])}><option value="elina">Elina</option><option value="byus">ByUs</option></select></label>
      <label><span>{t.channel}</span><select value={draft.channel} disabled={busyId !== null} onChange={(event) => change("channel", event.target.value as Draft["channel"])}>{channels.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>{t.contentType}</span><select value={draft.contentType} disabled={busyId !== null} onChange={(event) => change("contentType", event.target.value as Draft["contentType"])}>{contentTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>{t.name}</span><input required maxLength={80} value={draft.name} disabled={busyId !== null} onChange={(event) => change("name", event.target.value)} /></label>
      <label><span>{t.locale}</span><select value={draft.locale} disabled={busyId !== null} onChange={(event) => change("locale", event.target.value as Draft["locale"])}><option value="ko">{t.ko}</option><option value="en">{t.en}</option></select></label>
      <button className={styles.primaryButton} type="submit" disabled={busyId !== null}>{busyId === draft.id ? t.saving : t.submit}</button>
    </form>{visibleActionError === "create" && <p className={styles.actionError} role="alert">{t.createFailed}</p>}</section> : <p className={styles.viewerNote}>{t.viewer}</p>}
    {visibleActionError === "stop" && <p className={styles.actionError} role="alert">{t.stopFailed}</p>}
    {visible.status === "loading" && <div className={base.loading} role="status"><span /> <span /> <span /></div>}
    {visible.status === "error" && <section className={base.error} role="alert"><p>{t.loadFailed}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>{t.retry}</button></section>}
    {visible.status === "ready" && <BanksyCampaignContent data={visible.data} locale={locale} canWrite={canWrite} busyId={busyId} copyState={copyState} onStop={(id) => void command({ action: "stop", id })} onCopy={(id) => void copyLink(id)} />}
  </div></AdminOperationsShell>;
}
