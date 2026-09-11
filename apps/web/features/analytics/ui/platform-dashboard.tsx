"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { AdminAccessState } from "../../../components/admin/admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import type { Metric } from "../domain/admin-analytics";
import type { PlatformAnalytics } from "../../../server/g6/platform-analytics-repository";
import { AnalyticsWindowControl, analyticsWindowFromSearch, defaultAnalyticsWindow, type AnalyticsWindowSelection } from "./analytics-window-control";
import { AnalyticsLineChart } from "./analytics-line-chart";
import { PerformanceTable, type PerformanceColumn } from "./performance-table";
import styles from "./analytics-dashboard.module.css";

type CreatorRow = {
  celebrityId: string; name: string; fans: number; passports: number;
  reactions: number; reservations: number; attendances: number; transactions: number;
};
type LiveRow = {
  liveEventId: string; title: string; startsAt: string;
  reservations: number; attendances: number; transactions: number;
};
type TrendKey = "newFans" | "passports" | "reactions" | "reservations" | "attendances" | "transactions";

function value(metric: Metric<number>, locale: AdminLocale) {
  return metric.state === "available" ? metric.value!.toLocaleString(locale)
    : metric.state === "suppressed" ? (locale === "ko" ? "표본 보호" : "Suppressed")
    : metric.state === "not_applicable" ? (locale === "ko" ? "해당 없음" : "N/A")
    : locale === "ko" ? "조회 불가" : "Unavailable";
}

function Card({ label, description, metric, locale }: { label: string; description: string; metric: Metric<number>; locale: AdminLocale }) {
  return (
    <article className={styles.metric} data-state={metric.state}>
      <h3>{label}</h3>
      <strong>{value(metric, locale)}</strong>
      <p>{description}</p>
    </article>
  );
}

function DataState({ state, locale }: { state: Exclude<Metric<unknown>["state"], "available">; locale: AdminLocale }) {
  const ko = locale === "ko";
  const message = state === "suppressed"
    ? (ko ? "소규모 표본을 보호하기 위해 표시하지 않습니다." : "Hidden to protect a small cohort.")
    : state === "not_applicable"
      ? (ko ? "이 항목에는 적용되지 않는 지표입니다." : "This metric does not apply.")
      : (ko ? "현재 데이터를 조회할 수 없습니다." : "Data is currently unavailable.");
  return <div className={styles.dataState} data-state={state}><strong>{state === "suppressed" ? (ko ? "표본 보호" : "Suppressed") : state === "not_applicable" ? (ko ? "해당 없음" : "N/A") : (ko ? "조회 불가" : "Unavailable")}</strong><p>{message}</p></div>;
}

function TrendSection({ data, locale }: { data: PlatformAnalytics["trend"]; locale: AdminLocale }) {
  const ko = locale === "ko";
  const options: Array<{ key: TrendKey; label: string }> = [
    { key: "newFans", label: ko ? "신규 가입" : "New members" },
    { key: "passports", label: ko ? "패스포트 발급" : "Passport issuance" },
    { key: "reactions", label: ko ? "첫 응원" : "First cheers" },
    { key: "reservations", label: ko ? "예약 건수" : "Reservation records" },
    { key: "attendances", label: ko ? "출석 건수" : "Attendance records" },
    { key: "transactions", label: ko ? "발급 작업" : "Issuance jobs" },
  ];
  const [selected, setSelected] = useState<TrendKey>("newFans");
  if (data.state !== "available") return <DataState state={data.state} locale={locale} />;
  const selectedLabel = options.find((option) => option.key === selected)?.label ?? selected;
  return (
    <>
      <div className={styles.metricTabs} aria-label={ko ? "추이 지표" : "Trend metric"}>
        {options.map((option) => (
          <button key={option.key} type="button" aria-pressed={selected === option.key} onClick={() => setSelected(option.key)}>
            {option.label}
          </button>
        ))}
      </div>
      <AnalyticsLineChart
        label={selectedLabel}
        locale={locale}
        points={data.value.map((point) => ({ label: point.date.slice(5), value: point[selected] }))}
      />
    </>
  );
}

function CreatorPerformance({ data, locale }: { data: PlatformAnalytics["creators"]; locale: AdminLocale }) {
  const ko = locale === "ko";
  if (data.state !== "available") return <DataState state={data.state} locale={locale} />;
  const columns: PerformanceColumn<CreatorRow>[] = [
    { key: "name", label: ko ? "크리에이터" : "Creator", value: (row) => row.name, render: (row) => <Link href={`/admin/celebrities/${row.celebrityId}/quiz` as Route}>{row.name}</Link> },
    { key: "fans", label: ko ? "누적 팬" : "Cumulative fans", value: (row) => row.fans },
    { key: "passports", label: ko ? "패스포트 발급" : "Passport issuance", value: (row) => row.passports },
    { key: "reactions", label: ko ? "첫 응원" : "First cheers", value: (row) => row.reactions },
    { key: "reservations", label: ko ? "예약 건수" : "Reservation records", value: (row) => row.reservations },
    { key: "attendances", label: ko ? "출석 건수" : "Attendance records", value: (row) => row.attendances },
    { key: "transactions", label: ko ? "발급 작업" : "Issuance jobs", value: (row) => row.transactions },
  ];
  return <PerformanceTable columns={columns} rows={data.value} rowKey={(row) => row.celebrityId} title={ko ? "크리에이터 성과" : "Creator performance"} filename="byus-creator-performance.csv" locale={locale} />;
}

function LivePerformance({ data, locale }: { data: PlatformAnalytics["lives"]; locale: AdminLocale }) {
  const ko = locale === "ko";
  if (data.state !== "available") return <DataState state={data.state} locale={locale} />;
  const formatDate = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: "Asia/Seoul", dateStyle: "short" }).format(new Date(date));
  const columns: PerformanceColumn<LiveRow>[] = [
    { key: "title", label: "LIVE", value: (row) => row.title, render: (row) => <Link href={`/admin/lives/${row.liveEventId}/analytics` as Route}>{row.title}</Link> },
    { key: "startsAt", label: ko ? "시작" : "Starts", value: (row) => row.startsAt, render: (row) => formatDate(row.startsAt) },
    { key: "reservations", label: ko ? "예약 건수" : "Reservation records", value: (row) => row.reservations },
    { key: "attendances", label: ko ? "출석 건수" : "Attendance records", value: (row) => row.attendances },
    { key: "transactions", label: ko ? "발급 작업" : "Issuance jobs", value: (row) => row.transactions },
  ];
  return <PerformanceTable columns={columns} rows={data.value} rowKey={(row) => row.liveEventId} title={ko ? "LIVE 성과" : "LIVE performance"} filename="byus-live-performance.csv" locale={locale} />;
}

function TechnicalDetails({ data, locale }: { data: PlatformAnalytics; locale: AdminLocale }) {
  const ko = locale === "ko";
  const entries = [
    [ko ? "지갑 연결 회원" : "Members with wallets", data.totals.fansAndWallets],
    [ko ? "패스포트 발급 건수" : "Passport issuance", data.totals.passports],
    [ko ? "활성 크리에이터" : "Active creators", data.totals.activeCreators],
    [ko ? "첫 응원 건수" : "First cheers", data.totals.firstReactions],
    [ko ? "예약 회원" : "Members with reservations", data.totals.reservations],
    [ko ? "출석 회원" : "Members with attendance", data.totals.attendances],
    [ko ? "발급 작업" : "Issuance jobs", data.totals.onchainActions],
    [ko ? "기간 추이" : "Trend", data.trend],
    [ko ? "크리에이터 성과" : "Creator performance", data.creators],
    [ko ? "LIVE 성과" : "LIVE performance", data.lives],
    [ko ? "온체인 전체" : "On-chain total", data.chain.total],
    [ko ? "온체인 고유 회원" : "Unique on-chain members", data.chain.uniqueFans],
    [ko ? "온체인 완료" : "On-chain successful", data.chain.successful],
    [ko ? "온체인 처리 중" : "On-chain pending", data.chain.pending],
    [ko ? "온체인 실패" : "On-chain failed", data.chain.failed],
    [ko ? "발급 유형" : "Issuance types", data.chain.breakdown],
  ] as const;
  return (
    <details className={styles.technicalDetails}>
      <summary>{ko ? "기술 정보" : "Technical details"}</summary>
      <dl>
        {entries.map(([label, metric]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{[metric.source, metric.reason].filter(Boolean).join(" · ") || (ko ? "정보 없음" : "No details")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function PlatformDashboardContent({ data, locale = "ko" }: { data: PlatformAnalytics; locale?: AdminLocale }) {
  const ko = locale === "ko";
  const cards = [
    [ko ? "지갑 연결 회원" : "Members with wallets", ko ? "전체 가입자 수와 지갑 연결 회원 수가 일치할 때 표시됩니다." : "Shown when total members and members with wallets match.", data.totals.fansAndWallets],
    [ko ? "패스포트 발급 건수" : "Passport issuance", ko ? "선택 기간에 발급된 패스포트입니다." : "Passports issued in the selected period.", data.totals.passports],
    [ko ? "활성 크리에이터" : "Active creators", ko ? "선택 기간에 팬 활동이 발생한 크리에이터입니다." : "Creators with fan activity in the selected period.", data.totals.activeCreators],
    [ko ? "첫 응원 건수" : "First cheers", ko ? "선택 기간에 완료된 첫 응원입니다." : "First cheers completed in the selected period.", data.totals.firstReactions],
    [ko ? "예약 회원" : "Members with reservations", ko ? "선택 기간에 예약한 고유 회원입니다." : "Unique members who reserved in the selected period.", data.totals.reservations],
    [ko ? "출석 회원" : "Members with attendance", ko ? "선택 기간에 출석한 고유 회원입니다." : "Unique members who attended in the selected period.", data.totals.attendances],
    [ko ? "발급 작업" : "Issuance jobs", ko ? "선택 기간에 생성된 온체인 발급 작업입니다." : "On-chain issuance jobs created in the selected period.", data.totals.onchainActions],
  ] as const;
  return (
    <div className={styles.dashboard}>
      <div className={styles.metricGrid}>{cards.map(([label, description, metric]) => <Card key={label} label={label} description={description} metric={metric} locale={locale} />)}</div>
      <section className={styles.section}><div className={styles.sectionHeading}><div><h2>{ko ? "기간 추이" : "Trend"}</h2><p>{ko ? "단위가 같은 지표를 하나씩 선택해 실제 규모로 비교합니다." : "Select one like-for-like metric to view its true scale."}</p></div></div><TrendSection data={data.trend} locale={locale} /></section>
      <div className={styles.split}>
        <section className={styles.section}><div className={styles.sectionHeading}><div><h2>{ko ? "크리에이터 성과" : "Creator performance"}</h2><p>{ko ? "누적 팬은 선택 기간과 관계없이 현재까지 팬 관계를 맺은 회원이며, 나머지 항목은 선택 기간의 기록입니다." : "Cumulative fans cover all time; the remaining columns cover the selected period."}</p></div></div><CreatorPerformance data={data.creators} locale={locale} /></section>
        <section className={styles.section}><div className={styles.sectionHeading}><div><h2>{ko ? "LIVE 성과" : "LIVE performance"}</h2><p>{ko ? "예약과 출석, 온체인 처리를 LIVE별로 확인합니다." : "Review reservations, attendance, and on-chain processing by LIVE."}</p></div></div><LivePerformance data={data.lives} locale={locale} /></section>
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>{ko ? "온체인 상태" : "On-chain status"}</h2><p>{ko ? "발급 작업의 처리 결과와 실패 건을 확인합니다." : "Check issuance outcomes and failed work."}</p></div></div>
        <div className={styles.metricGrid}>
          <Card label={ko ? "전체 발급 작업" : "Total issuance jobs"} description={ko ? "선택 기간에 생성된 전체 작업입니다." : "All jobs created in the selected period."} metric={data.chain.total} locale={locale} />
          <Card label={ko ? "발급 회원" : "Members issued to"} description={ko ? "발급 작업이 연결된 고유 회원입니다." : "Unique members linked to issuance jobs."} metric={data.chain.uniqueFans} locale={locale} />
          <Card label={ko ? "처리 완료" : "Completed"} description={ko ? "정상적으로 완료된 발급 작업입니다." : "Issuance jobs completed successfully."} metric={data.chain.successful} locale={locale} />
          <Card label={ko ? "처리 중" : "In progress"} description={ko ? "대기·처리·재시도 중인 작업입니다." : "Jobs pending, processing, or retrying."} metric={data.chain.pending} locale={locale} />
          <Card label={ko ? "실패" : "Failed"} description={ko ? "확인이 필요한 실패 작업입니다." : "Failed jobs requiring review."} metric={data.chain.failed} locale={locale} />
        </div>
        {data.chain.breakdown.state === "available" && <p className={styles.source}>{ko ? "패스포트" : "Passport"} {data.chain.breakdown.value.passport} · {ko ? "첫 응원" : "First cheer"} {data.chain.breakdown.value.reaction} · {ko ? "스탬프" : "Stamp"} {data.chain.breakdown.value.stamp} · {ko ? "디지털 소장품" : "Collectible"} {data.chain.breakdown.value.collectible}</p>}
        <div className={styles.chainLinks}><Link href="/admin/blockchain-jobs">{ko ? "실패 작업 확인·재시도" : "Review and retry failed jobs"}</Link><Link href="/admin/notifications">{ko ? "알림 전송 확인" : "Notification delivery"}</Link></div>
      </section>
      <TechnicalDetails data={data} locale={locale} />
    </div>
  );
}

export function PlatformDashboard({ locale = "ko" }: { locale?: AdminLocale }) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const [windowValue, setWindow] = useState<AnalyticsWindowSelection>(() => defaultAnalyticsWindow());
  const [windowReady, setWindowReady] = useState(false);
  const [state, setState] = useState<{ loading: boolean; data?: PlatformAnalytics; error?: string }>({ loading: true });
  useEffect(() => { setWindow(analyticsWindowFromSearch(window.location.search, defaultAnalyticsWindow())); setWindowReady(true); }, []);
  useEffect(() => {
    if (!windowReady || session.status !== "authorized") return;
    const controller = new AbortController();
    (async () => {
      setState({ loading: true });
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("UNAUTHENTICATED");
        const p = new URLSearchParams({ from: windowValue.from, to: windowValue.to, asOf: windowValue.asOf });
        const language = locale === "en" ? "&lang=en" : "";
        window.history.replaceState(null, "", `/admin/dashboard?${p}${language}`);
        const response = await fetch(`/api/admin/analytics/platform?${p}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        setState({ loading: false, data: await response.json() });
      } catch (error) {
        if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : "UNAVAILABLE" });
      }
    })();
    return () => controller.abort();
  }, [getAccessToken, locale, session.status, windowReady, windowValue]);
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  const ko = locale === "ko";
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.dashboard}>
        <header className={styles.hero}><div><p className={styles.eyebrow}>{ko ? "상세 분석" : "Detailed analytics"}</p><h1>{ko ? "팬 여정 성과" : "Fan journey performance"}</h1><p>{ko ? "팬 성장과 LIVE 참여, 운영 작업을 한국 시간 기준으로 확인합니다." : "Review fan growth, LIVE participation, and operations in Asia/Seoul time."}</p></div></header>
        <AnalyticsWindowControl value={windowValue} onApply={setWindow} locale={locale} />
        {state.loading ? <p className={styles.status} role="status">{ko ? "분석 불러오는 중" : "Loading analytics"}</p>
          : state.error ? <p className={styles.status} data-error role="alert">{ko ? "분석을 불러오지 못했습니다" : "Analytics unavailable"} · {state.error}</p>
          : state.data && <><p className={styles.source}>{ko ? "마지막 집계" : "As of"}: <time dateTime={state.data.window.asOf}>{new Intl.DateTimeFormat(locale, { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(state.data.window.asOf))}</time></p><PlatformDashboardContent data={state.data} locale={locale} /></>}
      </div>
    </AdminOperationsShell>
  );
}
