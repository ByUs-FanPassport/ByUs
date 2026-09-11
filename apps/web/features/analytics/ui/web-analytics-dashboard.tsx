"use client";

import { usePrivy } from "@privy-io/react-auth";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminAccessState } from "../../../components/admin/admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import { webAnalyticsSchema, type WebAnalyticsData, type WebAnalyticsDays, type WebAnalyticsRow } from "../domain/web-analytics";
import { AnalyticsLineChart } from "./analytics-line-chart";
import base from "./admin-overview-dashboard.module.css";
import styles from "./web-analytics-dashboard.module.css";

type Metric = "visitors" | "pageviews";
const format = (value: number, locale: AdminLocale) => new Intl.NumberFormat(locale).format(value);
const date = (value: string, locale: AdminLocale, withTime = false) => new Intl.DateTimeFormat(locale, {
  timeZone: "UTC", month: "short", day: "numeric",
  ...(withTime ? { hour: "2-digit", minute: "2-digit" } as const : {}),
}).format(new Date(value));

function dimensionLabel(value: string, kind: string, locale: AdminLocale) {
  const ko = locale === "ko";
  if (value === "Others") return ko ? "기타" : "Others";
  if (!value || value === "(none)") return kind === "referrers" ? ko ? "직접 유입 / 확인 불가" : "Direct / unknown" : ko ? "확인 불가" : "Unknown";
  if (kind === "countries" && /^[A-Z]{2}$/.test(value)) {
    return new Intl.DisplayNames([locale], { type: "region" }).of(value) ?? value;
  }
  if (kind === "devices" && ko) return ({ mobile: "모바일", desktop: "데스크톱", tablet: "태블릿" } as Record<string, string>)[value] ?? value;
  return value;
}

function Breakdown({ title, kind, rows, locale }: {
  title: string; kind: string; rows: WebAnalyticsRow[]; locale: AdminLocale;
}) {
  const ko = locale === "ko";
  return <section className={`${base.panel} ${styles.breakdown}`} aria-label={title}>
    <div className={base.panelHeading}><h2>{title}</h2></div>
    {rows.length === 0 ? <p className={styles.empty}>{ko ? "이 기간에 기록된 방문이 없습니다." : "No visits recorded in this period."}</p> :
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={ko ? `${title} 상세 목록` : `${title} details`}><table className={styles.table}>
        <thead><tr><th scope="col">{ko ? "항목" : "Source"}</th><th scope="col">{ko ? "방문자" : "Visitors"}</th><th scope="col">{ko ? "페이지뷰" : "Views"}</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row.label}-${index}`}>
          <th scope="row">{dimensionLabel(row.label, kind, locale)}</th>
          <td>{format(row.visitors, locale)}</td><td>{format(row.pageviews, locale)}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

export function WebAnalyticsContent({ data, locale = "ko" }: { data: WebAnalyticsData; locale?: AdminLocale }) {
  const ko = locale === "ko";
  const [metric, setMetric] = useState<Metric>("visitors");
  const names = { visitors: ko ? "방문자" : "Visitors", pageviews: ko ? "페이지뷰" : "Page views" };
  const breakdowns = [
    ["pages", ko ? "인기 페이지" : "Top pages"],
    ["referrers", ko ? "유입 경로" : "Referrers"],
    ["countries", ko ? "국가" : "Countries"],
    ["devices", ko ? "기기" : "Devices"],
    ["browsers", ko ? "브라우저" : "Browsers"],
    ["operatingSystems", ko ? "운영체제" : "Operating systems"],
  ] as const;
  return <div className={base.content}>
    <section className={`${base.panel} ${styles.traffic}`} aria-label={ko ? "방문 추이" : "Traffic trend"}>
      <div className={styles.metrics} role="group" aria-label={ko ? "차트 지표" : "Chart metric"}>
        {(["visitors", "pageviews"] as const).map((key) => <button key={key} type="button" onClick={() => setMetric(key)} aria-pressed={metric === key}>
          <span>{names[key]}</span><strong>{format(data.totals[key], locale)}</strong>
          <small>{key === "visitors" ? ko ? "비로그인 방문 포함" : "Includes signed-out visits" : ko ? "페이지가 조회된 횟수" : "Total page views"}</small>
        </button>)}
      </div>
      <div className={styles.chartHeading}><h2>{ko ? `일별 ${names[metric]}` : `Daily ${names[metric].toLowerCase()}`}</h2><span>UTC</span></div>
      <AnalyticsLineChart locale={locale} label={names[metric]} points={data.trend.map((point) => ({ label: date(point.date, locale), value: point[metric] }))} />
    </section>
    <div className={styles.breakdowns}>{breakdowns.map(([kind, title]) =>
      <Breakdown key={kind} title={title} kind={kind} rows={data.breakdowns[kind]} locale={locale} />)}</div>
    <details className={base.definitions}><summary>{ko ? "방문 통계 집계 기준" : "How traffic is measured"}</summary><div>
      <p>{ko ? "Vercel Web Analytics가 수집한 공개 페이지의 Production 방문 기록입니다. 비로그인 방문을 포함하며, 회원 수·활동 회원 수와는 다릅니다. 관리자와 비공개 페이지는 수집 대상에서 제외됩니다." : "Production visits to public pages tracked by Vercel Web Analytics. Includes signed-out visits and differs from registered or active members. Admin and private pages are excluded from tracking."}</p>
      <p>{ko ? "날짜와 일별 구간은 UTC 기준이며 오늘을 포함합니다. 오늘 수치는 집계 중입니다. 한 방문자가 여러 페이지나 경로에 포함될 수 있어 항목별 방문자의 합은 전체 방문자와 다를 수 있습니다." : "Dates and daily intervals use UTC and include today. Today's figures are still accumulating. A visitor may appear in multiple rows, so row totals may differ from the overall visitor count."}</p>
      <p>{ko ? "새로고침해도 최대 5분 동안 같은 집계 결과가 표시될 수 있습니다. 회원 가입·LIVE 예약·출석·경품 응모는 기존 서비스 통계에서 확인할 수 있습니다." : "Refreshing may show the same results for up to five minutes. See service analytics for signups, LIVE reservations, attendance and prize entries."}</p>
    </div></details>
  </div>;
}

type State = { status: "loading" } | { status: "ready"; owner: string; data: WebAnalyticsData }
  | { status: "error"; code?: string } | { status: "unauthenticated" | "denied" };

export function WebAnalyticsDashboard({ locale = "ko" }: { locale?: AdminLocale }) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const [days, setDays] = useState<WebAnalyticsDays>(7);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });
  const owner = session.status === "authorized" ? session.admin.email : null;
  const ko = locale === "ko";
  useEffect(() => {
    if (session.status !== "authorized") return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (controller.signal.aborted) return;
        if (!token) { setState({ status: "unauthenticated" }); return; }
        const response = await fetch(`/api/admin/analytics/web?days=${days}`, {
          headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setState({ status: response.status === 401 ? "unauthenticated" : "denied" }); return;
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!controller.signal.aborted) setState({ status: "error", code: typeof body?.error?.code === "string" ? body.error.code : undefined });
          return;
        }
        const data = webAnalyticsSchema.parse(await response.json());
        if (!controller.signal.aborted) setState({ status: "ready", data, owner: owner ?? "" });
      } catch { if (!controller.signal.aborted) setState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [session.status, owner, getAccessToken, days, refresh]);
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  if (state.status === "unauthenticated" || state.status === "denied") return <AdminAccessState status={state.status} locale={locale} />;
  const visible: State = state.status === "ready" && (state.owner !== owner || state.data.days !== days) ? { status: "loading" } : state;
  return <AdminOperationsShell locale={locale} adminRole={session.admin.role}><div className={`${base.dashboard} ${styles.dashboard}`}>
    <header className={base.header}><div><p>BYUS · WEB ANALYTICS</p><h1>{ko ? "방문 통계" : "Web traffic"}</h1><span>{ko ? "팬들이 어떤 페이지를 찾고, 어디에서 들어오는지 확인하세요." : "See which pages fans visit and how they find ByUs."}</span></div>
      <button className={base.refresh} type="button" onClick={() => setRefresh((value) => value + 1)} disabled={visible.status === "loading"}><RefreshCw aria-hidden="true" />{ko ? "새로고침" : "Refresh"}</button>
    </header>
    <div className={base.toolbar}><div className={base.segmented} role="group" aria-label={ko ? "방문 통계 조회 기간" : "Traffic reporting period"}>
      {([7, 30, 90] as const).map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{ko ? `최근 ${value}일` : `Last ${value} days`}</button>)}
    </div><p aria-live="polite">{visible.status === "ready" ? `${date(visible.data.from, locale)} – ${date(new Date(Date.parse(visible.data.to) - 1).toISOString(), locale)} · UTC · Production` : "Vercel Analytics · Production"}</p></div>
    {visible.status === "loading" && <div className={base.loading} role="status"><div className={base.skeletonChart} /><span>{ko ? "방문 통계를 불러오고 있습니다." : "Loading web traffic…"}</span></div>}
    {visible.status === "error" && <section className={base.error} role="alert"><CircleAlert aria-hidden="true" /><h2>{ko ? "방문 통계를 불러오지 못했습니다" : "Could not load web traffic"}</h2><p>{ko ? "잠시 후 다시 시도해 주세요. 서비스 현황과 회원 통계는 계속 확인할 수 있습니다." : "Try again in a moment. Service and member analytics remain available."}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>{ko ? "다시 시도" : "Try again"}</button></section>}
    {visible.status === "ready" && <><WebAnalyticsContent data={visible.data} locale={locale} /><p className={styles.updated}>{ko ? "마지막 조회" : "Last fetched"} {date(visible.data.fetchedAt, locale, true)} · UTC · Vercel Web Analytics</p></>}
  </div></AdminOperationsShell>;
}
