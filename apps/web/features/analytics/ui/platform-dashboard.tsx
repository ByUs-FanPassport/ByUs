"use client";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AdminAccessState } from "../../../components/admin/admin-access-state";
import {
  AdminOperationsShell,
  type AdminLocale,
} from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import type { Metric } from "../domain/admin-analytics";
import type { PlatformAnalytics } from "../../../server/g6/platform-analytics-repository";
import {
  AnalyticsWindowControl,
  analyticsWindowFromSearch,
  defaultAnalyticsWindow,
  type AnalyticsWindowSelection,
} from "./analytics-window-control";
import styles from "./analytics-dashboard.module.css";
function value(metric: Metric<number>, locale: AdminLocale) {
  return metric.state === "available"
    ? String(metric.value)
    : metric.state === "suppressed"
      ? locale === "ko"
        ? "표본 보호"
        : "Suppressed"
      : metric.state === "not_applicable"
        ? "N/A"
        : locale === "ko"
          ? "조회 불가"
          : "Unavailable";
}
function Card({
  label,
  metric,
  locale,
}: {
  label: string;
  metric: Metric<number>;
  locale: AdminLocale;
}) {
  return (
    <article className={styles.metric} data-state={metric.state}>
      <h3>{label}</h3>
      <strong>{value(metric, locale)}</strong>
      <p>{metric.source ?? metric.reason}</p>
    </article>
  );
}
export function PlatformDashboardContent({
  data,
  locale = "ko",
}: {
  data: PlatformAnalytics;
  locale?: AdminLocale;
}) {
  const ko = locale === "ko",
    labels = ko
      ? [
          "팬·지갑",
          "패스포트",
          "활성 크리에이터",
          "첫 리액션",
          "예약",
          "출석",
          "온체인 액션",
        ]
      : [
          "Fans & wallets",
          "Passports",
          "Active creators",
          "First reactions",
          "Reservations",
          "Attendances",
          "On-chain actions",
        ],
    metrics = [
      data.totals.fansAndWallets,
      data.totals.passports,
      data.totals.activeCreators,
      data.totals.firstReactions,
      data.totals.reservations,
      data.totals.attendances,
      data.totals.onchainActions,
    ];
  return (
    <div className={styles.dashboard}>
      <div className={styles.metricGrid}>
        {metrics.map((m, i) => (
          <Card key={labels[i]} label={labels[i]} metric={m} locale={locale} />
        ))}
      </div>
      <section className={styles.section}>
        <h2>{ko ? "기간 추이" : "Trend"}</h2>
        {data.trend.state === "available" && (
          <>
            <div className={styles.trendBars} aria-hidden="true">
              {data.trend.value.map((point) => (
                <span
                  key={point.date}
                  className={styles.trendBar}
                  style={{
                    height: `${Math.max(4, Math.min(100, (point.newFans + point.passports + point.reactions + point.reservations + point.attendances + point.transactions) * 8))}%`,
                  }}
                />
              ))}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{ko ? "날짜" : "Date"}</th>
                    <th>{ko ? "신규 팬" : "New fans"}</th>
                    <th>Passport</th>
                    <th>Reaction</th>
                    <th>{ko ? "예약" : "Reservations"}</th>
                    <th>{ko ? "출석" : "Attendance"}</th>
                    <th>{ko ? "트랜잭션" : "Transactions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trend.value.map((p) => (
                    <tr key={p.date}>
                      <td>{p.date}</td>
                      <td>{p.newFans}</td>
                      <td>{p.passports}</td>
                      <td>{p.reactions}</td>
                      <td>{p.reservations}</td>
                      <td>{p.attendances}</td>
                      <td>{p.transactions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <div className={styles.split}>
        <section className={styles.section}>
          <h2>{ko ? "크리에이터 성과" : "Creator performance"}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{ko ? "크리에이터" : "Creator"}</th>
                  <th>{ko ? "팬" : "Fans"}</th>
                  <th>Passport</th>
                  <th>Reaction</th>
                  <th>{ko ? "예약" : "Reservations"}</th>
                  <th>{ko ? "출석" : "Attendance"}</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.creators.state === "available" &&
                  data.creators.value.map((c) => (
                    <tr key={c.celebrityId}>
                      <td>
                        <Link
                          href={
                            `/admin/celebrities/${c.celebrityId}/quiz` as Route
                          }
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td>{c.fans}</td>
                      <td>{c.passports}</td>
                      <td>{c.reactions}</td>
                      <td>{c.reservations}</td>
                      <td>{c.attendances}</td>
                      <td>{c.transactions}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className={styles.section}>
          <h2>{ko ? "LIVE 성과" : "LIVE performance"}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>LIVE</th>
                  <th>{ko ? "시작" : "Starts"}</th>
                  <th>{ko ? "예약" : "Reservations"}</th>
                  <th>{ko ? "출석" : "Attendance"}</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.lives.state === "available" &&
                  data.lives.value.map((l) => (
                    <tr key={l.liveEventId}>
                      <td>
                        <Link
                          href={
                            `/admin/lives/${l.liveEventId}/analytics` as Route
                          }
                        >
                          {l.title}
                        </Link>
                      </td>
                      <td>
                        {new Intl.DateTimeFormat(locale, {
                          timeZone: "Asia/Seoul",
                          dateStyle: "short",
                        }).format(new Date(l.startsAt))}
                      </td>
                      <td>{l.reservations}</td>
                      <td>{l.attendances}</td>
                      <td>{l.transactions}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className={styles.section}>
        <h2>{ko ? "온체인 상태" : "On-chain status"}</h2>
        <div className={styles.metricGrid}>
          <Card
            label={ko ? "전체" : "Total"}
            metric={data.chain.total}
            locale={locale}
          />
          <Card
            label={ko ? "고유 팬" : "Unique fans"}
            metric={data.chain.uniqueFans}
            locale={locale}
          />
          <Card
            label={ko ? "성공" : "Successful"}
            metric={data.chain.successful}
            locale={locale}
          />
          <Card
            label={ko ? "대기" : "Pending"}
            metric={data.chain.pending}
            locale={locale}
          />
          <Card
            label={ko ? "실패" : "Failed"}
            metric={data.chain.failed}
            locale={locale}
          />
        </div>
        {data.chain.breakdown.state === "available" && (
          <p className={styles.source}>
            Passport {data.chain.breakdown.value.passport} · Reaction{" "}
            {data.chain.breakdown.value.reaction} · Stamp{" "}
            {data.chain.breakdown.value.stamp} · Collectible{" "}
            {data.chain.breakdown.value.collectible}
          </p>
        )}
        <div className={styles.chainLinks}>
          <Link href="/admin/blockchain-jobs">
            {ko ? "실패 작업 확인·재시도" : "Review and retry failed jobs"}
          </Link>
          <Link href="/admin/notifications">
            {ko ? "알림 전송 확인" : "Notification delivery"}
          </Link>
        </div>
      </section>
    </div>
  );
}
export function PlatformDashboard({ locale = "ko" }: { locale?: AdminLocale }) {
  const session = useAdminSession(),
    { getAccessToken } = usePrivy(),
    [windowValue, setWindow] = useState<AnalyticsWindowSelection>(() =>
      defaultAnalyticsWindow(),
    ),
    [windowReady, setWindowReady] = useState(false),
    [state, setState] = useState<{
      loading: boolean;
      data?: PlatformAnalytics;
      error?: string;
    }>({ loading: true });
  useEffect(() => {
    setWindow(
      analyticsWindowFromSearch(
        window.location.search,
        defaultAnalyticsWindow(),
      ),
    );
    setWindowReady(true);
  }, []);
  useEffect(() => {
    if (!windowReady || session.status !== "authorized") return;
    const controller = new AbortController();
    (async () => {
      setState({ loading: true });
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("UNAUTHENTICATED");
        const p = new URLSearchParams({
          from: windowValue.from,
          to: windowValue.to,
          asOf: windowValue.asOf,
        });
        window.history.replaceState(null, "", `/admin/dashboard?${p}`);
        const response = await fetch(`/api/admin/analytics/platform?${p}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        setState({ loading: false, data: await response.json() });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({
            loading: false,
            error: e instanceof Error ? e.message : "UNAVAILABLE",
          });
      }
    })();
    return () => controller.abort();
  }, [getAccessToken, session.status, windowReady, windowValue]);
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  const ko = locale === "ko";
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.dashboard}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>
              {ko ? "플랫폼 분석" : "Platform analytics"}
            </p>
            <h1>{ko ? "팬 여정 성과" : "Fan journey performance"}</h1>
            <p>
              {ko
                ? "운영 원장과 측정 이벤트를 구분해 집계합니다. 모든 시간은 한국 시간 기준입니다."
                : "Canonical operations and measurement events remain distinct. Times use Asia/Seoul."}
            </p>
          </div>
        </header>
        <AnalyticsWindowControl
          value={windowValue}
          onApply={setWindow}
          locale={locale}
        />
        {state.loading ? (
          <p className={styles.status} role="status">
            {ko ? "분석 불러오는 중" : "Loading analytics"}
          </p>
        ) : state.error ? (
          <p className={styles.status} data-error role="alert">
            {ko ? "분석을 불러오지 못했습니다" : "Analytics unavailable"} ·{" "}
            {state.error}
          </p>
        ) : (
          state.data && (
            <>
              <p className={styles.source}>
                {ko ? "마지막 집계" : "As of"}:{" "}
                <time dateTime={state.data.window.asOf}>
                  {new Intl.DateTimeFormat(locale, {
                    timeZone: "Asia/Seoul",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(state.data.window.asOf))}
                </time>
              </p>
              <PlatformDashboardContent data={state.data} locale={locale} />
            </>
          )
        )}
      </div>
    </AdminOperationsShell>
  );
}
