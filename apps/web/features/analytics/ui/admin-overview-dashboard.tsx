"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, CircleAlert, RefreshCw, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminAccessState } from "../../../components/admin/admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import { adminOverviewSchema, groupSignups, percentChange, type AdminOverviewData, type OverviewDays } from "../domain/admin-overview";
import { AnalyticsLineChart } from "./analytics-line-chart";
import styles from "./admin-overview-dashboard.module.css";

const number = (value: number, locale: AdminLocale) => new Intl.NumberFormat(locale).format(value);
const date = (value: string, locale: AdminLocale, time = false) => new Intl.DateTimeFormat(locale, {
  timeZone: "Asia/Seoul", month: "short", day: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } as const : {}),
}).format(new Date(value));
const href = (path: string, locale: AdminLocale) => `${path}${locale === "en" ? "?lang=en" : ""}` as Route;

function Change({ current, previous, locale }: { current: number; previous: number; locale: AdminLocale }) {
  const change = percentChange(current, previous), ko = locale === "ko";
  if (change === null) return <span className={styles.changeNeutral}>{ko ? `이전 ${number(previous, locale)}명 · 증감률 없음` : `Previously ${number(previous, locale)} · no rate`}</span>;
  const Icon = change < 0 ? ArrowDownRight : ArrowUpRight;
  return <span className={change === 0 ? styles.changeNeutral : change > 0 ? styles.changePositive : styles.changeNegative}>
    {change !== 0 && <Icon aria-hidden="true" />}{change > 0 ? "+" : ""}{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(change)}%
    <span>{ko ? "이전 기간 대비" : "vs. previous period"}</span>
  </span>;
}

function Metric({ label, value, note, children, primary = false, locale }: {
  label: string; value: number; note: string; children?: React.ReactNode; primary?: boolean; locale: AdminLocale;
}) {
  return <article className={`${styles.metric} ${primary ? styles.primaryMetric : ""}`}>
    <h2>{label}</h2><strong>{number(value, locale)}<span>{locale === "ko" ? "명" : ""}</span></strong>
    <p>{note}</p>{children}
  </article>;
}

export function AdminOverviewContent({ data, locale = "ko" }: { data: AdminOverviewData; locale?: AdminLocale }) {
  const ko = locale === "ko";
  const [interval, setInterval] = useState<"day" | "week" | "month">("day");
  const points = useMemo(() => groupSignups(data.trend, interval).map((p) => ({ label: date(`${p.date}T00:00:00+09:00`, locale), value: p.signups })), [data.trend, interval, locale]);
  const actions = [
    { label: ko ? "심사 대기" : "Awaiting review", detail: ko ? "팬 인증 내역 검토" : "Review fan verification", count: data.issues.certifications, path: "/admin/certifications" },
    { label: ko ? "발급 실패" : "Issuance failures", detail: ko ? "디지털 발급 작업 확인" : "Review digital issuance", count: data.issues.failedJobs, path: "/admin/blockchain-jobs" },
    { label: ko ? "알림 전송 실패" : "Delivery failures", detail: ko ? "최종 실패한 전송 확인" : "Review final delivery failures", count: data.issues.failedNotifications, path: "/admin/notifications" },
  ];
  const usage = [
    [ko ? "패스포트 발급" : "Passports issued", data.usage.passports],
    [ko ? "첫 응원" : "First reactions", data.usage.reactions],
    [ko ? "LIVE 예약" : "LIVE reservations", data.usage.reservations],
    [ko ? "LIVE 출석" : "LIVE attendance", data.usage.attendances],
    [ko ? "경품 응모" : "Prize entries", data.usage.entries],
  ] as const;
  const maxUsage = Math.max(1, ...usage.map(([, value]) => value));
  const statuses = [
    [ko ? "진행 중" : "Live now", data.content.live, styles.liveColor],
    [ko ? "예정" : "Scheduled", data.content.scheduled, styles.scheduledColor],
    [ko ? "종료" : "Ended", data.content.ended, styles.endedColor],
    [ko ? "취소" : "Cancelled", data.content.cancelled, styles.cancelledColor],
  ] as const;
  const liveTotal = statuses.reduce((sum, [, value]) => sum + value, 0);
  return <div className={styles.content}>
    <div className={styles.metrics}>
      <Metric label={ko ? "총 가입자" : "Registered members"} value={data.members.total} note={ko ? "현재까지 가입한 전체 회원" : "All registered accounts"} primary locale={locale}>
        <Link href={href("/admin/fans", locale)}>{ko ? "회원 관리" : "Manage members"}<ArrowRight aria-hidden="true" /></Link>
      </Metric>
      <Metric label={ko ? "신규 가입자" : "New members"} value={data.members.signups.current} note={ko ? `최근 ${data.days}일 · 오늘 포함` : `Last ${data.days} days · including today`} locale={locale}>
        <Change {...data.members.signups} locale={locale} />
      </Metric>
      <Metric label={ko ? "오늘 활동 회원" : "Active members today"} value={data.activity.daily} note={ko ? "DAU · 오늘 00시부터 현재까지" : "DAU · since midnight KST"} locale={locale}>
        <span className={styles.metricMeta}>{ko ? "기록된 방문·참여 기준" : "Tracked visits & participation"}</span>
      </Metric>
      <Metric label={ko ? "30일 활동 회원" : "Active members · 30 days"} value={data.activity.monthly} note={ko ? "MAU · 최근 30일 중복 제외" : "MAU · unique members over 30 days"} locale={locale}>
        <span className={styles.metricMeta}>{ko ? "로그인한 회원만 집계" : "Signed-in members only"}</span>
      </Metric>
    </div>

    <section className={styles.actions} aria-labelledby="overview-actions">
      <div className={styles.actionHeading}><h2 id="overview-actions">{ko ? "처리할 일" : "Needs attention"}</h2><p>{ko ? "현재 대기·실패 건" : "Current pending & failed items"}</p></div>
      {actions.map((action) => <Link key={action.path} href={href(action.path, locale)} className={styles.action} data-attention={action.count > 0}>
        {action.count > 0 ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
        <div><span>{action.label}</span><small>{action.detail}</small></div><strong>{number(action.count, locale)}<span>{ko ? "건" : ""}</span></strong><ArrowRight aria-hidden="true" />
      </Link>)}
    </section>

    <div className={styles.chartGrid}>
      <section className={styles.panel} aria-labelledby="signup-title">
        <div className={styles.panelHeading}><div><h2 id="signup-title">{ko ? "가입자 증가 추이" : "Member growth"}</h2><p>{ko ? "가입일 기준 · 한국 시간" : "By signup date · Korea Standard Time"}</p></div>
          <div className={styles.segmented} role="group" aria-label={ko ? "추이 집계 단위" : "Trend interval"}>
            {(["day", "week", "month"] as const).map((v, i) => <button key={v} type="button" onClick={() => setInterval(v)} aria-pressed={v === interval}>{(ko ? ["일간", "주간", "월간"] : ["Day", "Week", "Month"])[i]}</button>)}
          </div>
        </div>
        <AnalyticsLineChart points={points} label={ko ? "신규 가입자 (명)" : "New members"} locale={locale} />
        <div className={styles.growthComparisons}>
          <div><span>{ko ? "최근 7일 신규" : "New in 7 days"}</span><strong>{number(data.members.week.current, locale)}{ko ? "명" : ""}</strong><Change {...data.members.week} locale={locale} /></div>
          <div><span>{ko ? "최근 30일 신규" : "New in 30 days"}</span><strong>{number(data.members.month.current, locale)}{ko ? "명" : ""}</strong><Change {...data.members.month} locale={locale} /></div>
        </div>
        <p className={styles.footnote}>{ko ? "증감률은 직전 동일 시간 길이와 비교합니다. 첫 구간과 오늘은 일부 기간을 포함할 수 있습니다." : "Rates compare the preceding equal duration. The first bucket and today may be partial."}</p>
      </section>
      <section className={styles.panel} aria-labelledby="usage-title">
        <div className={styles.panelHeading}><div><h2 id="usage-title">{ko ? "팬들은 무엇을 했나요?" : "Fan participation"}</h2><p>{ko ? `최근 ${data.days}일 이용 건수` : `Actions in the last ${data.days} days`}</p></div></div>
        <div className={styles.usageBars}>{usage.map(([label, value]) => <div className={styles.usageRow} key={label}><div><span>{label}</span><strong>{number(value, locale)}<small>{ko ? "건" : ""}</small></strong></div><div className={styles.barTrack} aria-hidden="true"><span style={{ width: `${value / maxUsage * 100}%` }} /></div></div>)}</div>
        {usage.every(([, value]) => value === 0) && <p className={styles.footnote}>{ko ? "이 기간에 기록된 이용 내역이 없습니다." : "No participation was recorded in this period."}</p>}
        <Link className={styles.panelLink} href={href("/admin/dashboard", locale)}>{ko ? "상세 통계 보기" : "Explore analytics"}<ArrowRight aria-hidden="true" /></Link>
      </section>
    </div>

    <div className={styles.bottomGrid}>
      <section className={styles.panel} aria-labelledby="upcoming-title">
        <div className={styles.panelHeading}><div><h2 id="upcoming-title">{ko ? "진행 중·다가오는 LIVE" : "Live now & coming up"}</h2><p>{ko ? "공개 중인 LIVE를 가까운 순서로 확인하세요." : "Published LIVE events, nearest first."}</p></div><Link href={href("/admin/lives", locale)}>{ko ? "전체 보기" : "View all"}<ArrowRight aria-hidden="true" /></Link></div>
        {data.upcoming.length === 0 ? <div className={styles.empty}><CalendarDays aria-hidden="true" /><p>{ko ? "진행 중이거나 예정된 공개 LIVE가 없습니다." : "No published LIVE events are active or scheduled."}</p><Link href={href("/admin/lives", locale)}>{ko ? "LIVE 관리로 이동" : "Manage LIVE events"}</Link></div> :
          <ul className={styles.liveList}>{data.upcoming.map((live) => <li key={live.id}><Link href={href(`/admin/lives/${live.id}/analytics`, locale)}>
            <div className={styles.dateTile}><CalendarDays aria-hidden="true" /><span>{date(live.startsAt, locale)}</span></div>
            <div className={styles.liveInfo}><div><span className={styles.liveBadge} data-live={live.status === "live"}>{live.status === "live" ? ko ? "진행 중" : "Live now" : ko ? "예정" : "Scheduled"}</span><span>{live.creator}</span></div><h3>{ko ? live.title : live.titleEn}</h3><p>{date(live.startsAt, locale, true)} · KST</p></div>
            <div className={styles.reservations}><span>{ko ? "예약" : "Reservations"}</span><strong>{number(live.reservations, locale)}</strong></div><ArrowRight aria-hidden="true" />
          </Link></li>)}</ul>}
      </section>
      <section className={styles.panel} aria-labelledby="content-title">
        <div className={styles.panelHeading}><div><h2 id="content-title">{ko ? "서비스 운영 현황" : "Service status"}</h2><p>{ko ? "현재 공개된 콘텐츠" : "Currently published content"}</p></div></div>
        <div className={styles.creatorCount}><Users aria-hidden="true" /><span>{ko ? "공개 크리에이터" : "Published creators"}</span><strong>{number(data.content.creators, locale)}</strong></div>
        <div className={styles.statusTitle}><span>{ko ? "공개 LIVE" : "Published LIVE"}</span><strong>{number(liveTotal, locale)}{ko ? "개" : ""}</strong></div>
        <div className={styles.stackedBar} aria-hidden="true">{statuses.map(([label, value, color]) => <span key={label} className={color} style={{ width: `${liveTotal > 0 ? value / liveTotal * 100 : 0}%` }} />)}</div>
        <dl className={styles.statusList}>{statuses.map(([label, value, color]) => <div key={label}><dt><i className={color} aria-hidden="true" />{label}</dt><dd>{number(value, locale)}</dd></div>)}</dl>
        <Link className={styles.panelLink} href={href("/admin/lives", locale)}>{ko ? `미공개 LIVE ${number(data.content.drafts, locale)}개` : `${number(data.content.drafts, locale)} unpublished LIVE events`}<ArrowRight aria-hidden="true" /></Link>
      </section>
    </div>
    <details className={styles.definitions}><summary>{ko ? "지표 집계 기준" : "How these metrics are counted"}</summary><div>
      <p>{ko ? "가입자: 서비스에 가입한 전체 계정입니다. 이용 중지 계정도 포함하며, 지갑 수나 패스포트 수와는 다릅니다." : "Members are all registered accounts, including disabled accounts. This is distinct from wallets or Passports."}</p>
      <p>{ko ? "활동 회원: 로그인한 회원의 크리에이터·LIVE·혜택 방문과 참여 기록을 중복 없이 집계합니다. 비로그인 방문, 단순 로그인, 자동 보상·당첨·배송 처리는 포함하지 않습니다. 사이트의 모든 방문을 측정하는 수치는 아닙니다." : "Active members are unique signed-in members with tracked creator, LIVE or benefit visits and participation. Anonymous visits, sign-ins alone, automatic rewards, winner selection and fulfillment are excluded. These metrics do not measure all site traffic."}</p>
      <p>{ko ? `집계 기간: ${date(data.from, locale, true)}부터 ${date(data.asOf, locale, true)} 직전까지. 이전 비교 기간은 ${date(data.previousFrom, locale, true)}부터 현재 집계 시작 직전까지입니다.` : `Window: ${date(data.from, locale, true)} to before ${date(data.asOf, locale, true)}. Comparison: ${date(data.previousFrom, locale, true)} to before the current window.`}</p>
      <p>{ko ? "이용 건수는 행동별 발생 건수이며, 서로 다른 행동을 더해 전환율로 해석하지 않습니다. 대기·실패와 콘텐츠 상태는 조회 시점 기준입니다. 경품 응모는 접수 기록 수이며 사용한 응모권 수와 다릅니다." : "Usage counts individual action records, not funnel conversion. Queues and content show current state. Prize entries count entry records, not tickets spent."}</p>
      {data.activity.measuredSince && <p>{ko ? "활동 측정 기록 시작: " : "Activity records start: "}{date(data.activity.measuredSince, locale, true)} · KST</p>}
    </div></details>
  </div>;
}

export function AdminOverviewDashboard({ locale = "ko" }: { locale?: AdminLocale }) {
  const session = useAdminSession(), { getAccessToken } = usePrivy();
  const [days, setDays] = useState<OverviewDays>("30"), [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; data: AdminOverviewData; owner: string } | { status: "error" } | { status: "unauthenticated" | "denied" }>({ status: "loading" });
  const owner = session.status === "authorized" ? session.admin.email : null;
  useEffect(() => {
    if (session.status !== "authorized") return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) { if (!controller.signal.aborted) setState({ status: "unauthenticated" }); return; }
        const response = await fetch(`/api/admin/analytics/overview?days=${days}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setState({ status: response.status === 401 ? "unauthenticated" : "denied" }); return; }
        if (!response.ok) throw new Error("OVERVIEW_UNAVAILABLE");
        const data = adminOverviewSchema.parse(await response.json());
        if (!controller.signal.aborted) setState({ status: "ready", data, owner: owner ?? "" });
      } catch { if (!controller.signal.aborted) setState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [session.status, getAccessToken, days, refresh, owner]);
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  if (state.status === "unauthenticated" || state.status === "denied") return <AdminAccessState status={state.status} locale={locale} />;
  const visibleState = state.status === "ready" && (state.owner !== owner || state.data.days !== Number(days)) ? { status: "loading" as const } : state;
  const ko = locale === "ko";
  return <AdminOperationsShell locale={locale}><div className={styles.dashboard}>
    <header className={styles.header}><div><p>{ko ? "BYUS 운영 대시보드" : "BYUS OPERATIONS"}</p><h1>{ko ? "서비스 현황" : "Service overview"}</h1><span>{ko ? "회원의 성장과 팬들의 참여, 오늘 처리할 일을 한눈에 확인하세요." : "Member growth, fan participation and the work that needs your attention."}</span></div>
      <button className={styles.refresh} type="button" onClick={() => setRefresh((v) => v + 1)} disabled={visibleState.status === "loading"}><RefreshCw aria-hidden="true" />{ko ? "새로고침" : "Refresh"}</button>
    </header>
    <div className={styles.toolbar}><div className={styles.segmented} role="group" aria-label={ko ? "대시보드 조회 기간" : "Dashboard period"}>{(["7", "30", "90"] as const).map((v) => <button key={v} type="button" aria-pressed={days === v} onClick={() => setDays(v)}>{ko ? `최근 ${v}일` : `Last ${v} days`}</button>)}</div><p aria-live="polite">{visibleState.status === "ready" ? `${ko ? "업데이트" : "Updated"} ${date(visibleState.data.asOf, locale, true)} · KST` : visibleState.status === "loading" ? ko ? "현황을 불러오는 중…" : "Loading overview…" : ko ? "현황을 불러오지 못했습니다" : "Overview unavailable"}</p></div>
    {visibleState.status === "loading" && <div className={styles.loading} role="status"><div className={styles.skeletonCards}>{[0,1,2,3].map((v) => <div key={v} />)}</div><div className={styles.skeletonChart} /><span>{ko ? "회원·LIVE·운영 현황을 확인하고 있습니다." : "Loading member, LIVE and operations data."}</span></div>}
    {visibleState.status === "error" && <section className={styles.error} role="alert"><CircleAlert aria-hidden="true" /><h2>{ko ? "서비스 현황을 불러오지 못했습니다" : "Could not load the overview"}</h2><p>{ko ? "잠시 후 다시 시도해 주세요. 회원과 LIVE 관리 메뉴는 계속 사용할 수 있습니다." : "Try again in a moment. Member and LIVE management remain available."}</p><button type="button" onClick={() => setRefresh((v) => v + 1)}>{ko ? "다시 시도" : "Try again"}</button></section>}
    {visibleState.status === "ready" && <AdminOverviewContent data={visibleState.data} locale={locale} />}
  </div></AdminOperationsShell>;
}
