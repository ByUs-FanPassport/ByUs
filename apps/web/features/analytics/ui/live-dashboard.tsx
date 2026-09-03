"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AdminAccessState } from "../../../components/admin/admin-access-state";
import {
  AdminOperationsShell,
  type AdminLocale,
} from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import type { Metric, Ratio } from "../domain/admin-analytics";
import type { LiveAnalytics } from "../../../server/g6/live-analytics-repository";
import {
  AnalyticsWindowControl,
  analyticsWindowFromSearch,
  defaultAnalyticsWindow,
  type AnalyticsWindowSelection,
} from "./analytics-window-control";
import styles from "./analytics-dashboard.module.css";
function display(metric: Metric<number | Ratio>, locale: AdminLocale) {
  if (metric.state !== "available")
    return metric.state === "not_applicable"
      ? "N/A"
      : metric.state === "suppressed"
        ? locale === "ko"
          ? "표본 보호"
          : "Suppressed"
        : locale === "ko"
          ? "조회 불가"
          : "Unavailable";
  return typeof metric.value === "number"
    ? String(metric.value)
    : `${(metric.value!.rate * 100).toFixed(1)}%`;
}
function Card({
  label,
  metric,
  locale,
}: {
  label: string;
  metric: Metric<number | Ratio>;
  locale: AdminLocale;
}) {
  return (
    <article className={styles.metric} data-state={metric.state}>
      <h3>{label}</h3>
      <strong>{display(metric, locale)}</strong>
      {metric.state === "available" && typeof metric.value === "object" && (
        <p>
          {metric.value?.numerator} / {metric.value?.denominator}
        </p>
      )}
      <p>{metric.source ?? metric.reason}</p>
    </article>
  );
}
export function LiveDashboardContent({
  data,
  locale = "ko",
}: {
  data: LiveAnalytics;
  locale?: AdminLocale;
}) {
  const ko = locale === "ko";
  return (
    <div className={styles.dashboard}>
      <section className={styles.section}>
        <h2>
          {ko ? "방문 → 예약 → 출석" : "Visit → Reservation → Attendance"}
        </h2>
        <div className={styles.funnel}>
          <Card
            label={ko ? "방문" : "Visits"}
            metric={data.funnel.visits}
            locale={locale}
          />
          <span className={styles.funnelArrow} aria-hidden="true">
            →
          </span>
          <Card
            label={ko ? "예약" : "Reservations"}
            metric={data.funnel.reservations}
            locale={locale}
          />
          <span className={styles.funnelArrow} aria-hidden="true">
            →
          </span>
          <Card
            label={ko ? "출석" : "Attendance"}
            metric={data.funnel.attendances}
            locale={locale}
          />
        </div>
        <div className={styles.metricGrid}>
          <Card
            label={ko ? "예약 전환율" : "Reservation rate"}
            metric={data.funnel.reservationRate}
            locale={locale}
          />
          <Card
            label={ko ? "출석 전환율" : "Attendance rate"}
            metric={data.funnel.attendanceRate}
            locale={locale}
          />
        </div>
      </section>
      <section className={styles.section}>
        <h2>{ko ? "관계 형성" : "Relationship"}</h2>
        <div className={styles.metricGrid}>
          <Card
            label={ko ? "신규 팬" : "New fans"}
            metric={data.relationships.newFans}
            locale={locale}
          />
          <Card
            label={ko ? "신규 패스포트" : "New Passports"}
            metric={data.relationships.newPassports}
            locale={locale}
          />
          <Card
            label={ko ? "첫 리액션" : "First reactions"}
            metric={data.relationships.firstReactions}
            locale={locale}
          />
        </div>
      </section>
      <section className={styles.section}>
        <h2>{ko ? "미션 (퍼널과 별도)" : "Missions (outside funnel)"}</h2>
        {data.missions.state === "suppressed" ? (
          <p>{ko ? "소규모 표본 보호 중" : "Small cohort suppressed"}</p>
        ) : (
          data.missions.state === "available" && (
            <div className={styles.missionGrid}>
              {data.missions.value.length === 0 ? (
                <p>{ko ? "측정된 참여 0명" : "Measured participation: 0"}</p>
              ) : (
                data.missions.value.map((m) => (
                  <article className={styles.mission} key={m.missionId}>
                    <h3>
                      {m.title} · {m.type}
                    </h3>
                    <p>
                      {ko ? "참여" : "Participants"} {m.participants} ·{" "}
                      {ko ? "참여율" : "Rate"}{" "}
                      {m.participationRate === null
                        ? "N/A"
                        : `${(m.participationRate * 100).toFixed(1)}%`}
                    </p>
                    {m.type === "quiz" && (
                      <p>
                        {ko ? "정답" : "Correct"} {m.correct} ·{" "}
                        {ko ? "오답" : "Incorrect"} {m.incorrect} ·{" "}
                        {m.correctRate === null
                          ? "N/A"
                          : `${(m.correctRate * 100).toFixed(1)}%`}
                      </p>
                    )}
                    {m.options.length > 0 && (
                      <p>
                        {m.options
                          .map((o) => `${o.label} ${o.responses}`)
                          .join(" · ")}
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>
          )
        )}
        <p className={styles.source}>
          {data.missions.source ?? data.missions.reason}
        </p>
      </section>
      <div className={styles.split}>
        <section className={styles.section}>
          <h2>{ko ? "티켓·혜택" : "Tickets & Benefits"}</h2>
          <div className={styles.metricGrid}>
            <Card
              label={ko ? "획득" : "Earned"}
              metric={data.benefits.ticketsEarned}
              locale={locale}
            />
            <Card
              label={ko ? "사용" : "Used"}
              metric={data.benefits.ticketsUsed}
              locale={locale}
            />
            <Card
              label={ko ? "응모 팬" : "Applicants"}
              metric={data.benefits.applicants}
              locale={locale}
            />
            <Card
              label={ko ? "당첨 팬" : "Winners"}
              metric={data.benefits.winners}
              locale={locale}
            />
          </div>
        </section>
        <section className={styles.section}>
          <h2>Journey · Collectible</h2>
          <div className={styles.metricGrid}>
            <Card
              label={ko ? "자격 충족" : "Eligible"}
              metric={data.journey.eligible}
              locale={locale}
            />
            <Card
              label={ko ? "완료" : "Complete"}
              metric={data.journey.complete}
              locale={locale}
            />
            <Card
              label={ko ? "클레임" : "Claims"}
              metric={data.journey.claims}
              locale={locale}
            />
            <Card
              label={ko ? "클레임률" : "Claim rate"}
              metric={data.journey.claimRate}
              locale={locale}
            />
          </div>
        </section>
      </div>
      <section className={styles.section}>
        <h2>{ko ? "LIVE 온체인" : "LIVE on-chain"}</h2>
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
            {ko ? "실패 작업 확인·재시도" : "Review failed jobs"}
          </Link>
        </div>
      </section>
    </div>
  );
}
export function LiveDashboard({
  liveEventId,
  locale = "ko",
}: {
  liveEventId: string;
  locale?: AdminLocale;
}) {
  const session = useAdminSession(),
    { getAccessToken } = usePrivy(),
    [windowValue, setWindow] = useState<AnalyticsWindowSelection>(() =>
      defaultAnalyticsWindow(),
    ),
    [windowReady, setWindowReady] = useState(false),
    [state, setState] = useState<{
      loading: boolean;
      data?: LiveAnalytics;
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
        window.history.replaceState(
          null,
          "",
          `/admin/lives/${liveEventId}/analytics?${p}`,
        );
        const response = await fetch(
          `/api/admin/analytics/live-events/${liveEventId}?${p}`,
          {
            headers: { authorization: `Bearer ${token}` },
            signal: controller.signal,
            cache: "no-store",
          },
        );
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
  }, [getAccessToken, liveEventId, session.status, windowReady, windowValue]);
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  const ko = locale === "ko";
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.dashboard}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>
              {ko ? "LIVE 분석" : "LIVE analytics"}
            </p>
            <h1>
              {state.data?.live.title ??
                (ko ? "LIVE 성과" : "LIVE performance")}
            </h1>
            <p>
              {ko
                ? "미션은 방문·예약·출석 퍼널과 분리하고 운영 원장만 성과로 집계합니다."
                : "Missions remain outside the funnel; operational records are authoritative."}
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
            <LiveDashboardContent data={state.data} locale={locale} />
          )
        )}
      </div>
    </AdminOperationsShell>
  );
}
