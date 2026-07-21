"use client";

import {
  BarChart3,
  Blocks,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Database,
  RefreshCw,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminSession } from "./use-admin-session";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import styles from "./operations-dashboard.module.css";

type Locale = AdminLocale;
export type AnalyticsView = "creator" | "brand";
type Availability =
  "available" | "not_applicable" | "unavailable" | "suppressed";
type MetricEnvelope<T> = {
  state: Availability;
  value: T | null;
  reason: string | null;
  source: string | null;
  snapshotAt?: string;
  cohort?: string;
};
type WindowEnvelope = {
  from: string;
  to: string;
  semantics: "[from,to)";
  asOf: string;
};
type Ratio = { numerator: number; denominator: number; rate: number };
type SurveyAggregates = {
  responseCount: number;
  averageRating: number | null;
  ratingCount: number;
  purchaseIntentYes: number;
  purchaseIntentAnswered: number;
  purchaseIntentRate: number | null;
  futureInterestYes: number;
  futureInterestAnswered: number;
  futureInterestRate: number | null;
};
type EngagementMetrics = {
  reservationCount: MetricEnvelope<number>;
  attendanceCount: MetricEnvelope<number>;
  attendanceRate: MetricEnvelope<Ratio>;
  surveyResponseCount: MetricEnvelope<number>;
  surveyCompletionRate: MetricEnvelope<Ratio>;
  surveyAggregates: MetricEnvelope<SurveyAggregates>;
};
type CreatorAnalytics = {
  window: WindowEnvelope;
  metrics: {
    reservationUsers: MetricEnvelope<number>;
    passportsIssued: MetricEnvelope<number>;
    levelDistribution: MetricEnvelope<
      Record<
        "bronze" | "silver" | "gold" | "platinum" | "diamond" | "total",
        number
      >
    >;
    stampTypeCounts: MetricEnvelope<
      Record<
        "knowledge" | "reservation" | "attendance" | "survey" | "total",
        number
      >
    >;
  } & EngagementMetrics;
};
type BrandAnalytics = {
  window: WindowEnvelope;
  funnel: {
    reservationUsers: MetricEnvelope<number>;
    manualCommerce: MetricEnvelope<number>;
  } & EngagementMetrics;
};
type LoadState<T> =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: T; refreshedAt: string }
  | { status: "error"; code: string };

const copy = {
  ko: {
    overview: "운영 개요",
    analytics: "분석",
    creator: "크리에이터",
    brand: "브랜드",
    content: "셀럽 콘텐츠",
    jobs: "블록체인 작업",
    audit: "감사 로그",
    signedIn: "활성 관리자 세션",
    heading: "오늘 확인할 운영 상태",
    headingBody:
      "실제 운영 API에서 확인된 항목만 표시합니다. 조회되지 않은 값은 추정하지 않습니다.",
    dashboardHeading: "성과 분석",
    dashboardBody:
      "조회 범위와 데이터 출처를 함께 확인하세요. 0은 측정된 값이며 N/A와 조회 불가는 별도 상태입니다.",
    loginTitle: "관리자 로그인이 필요합니다",
    loginBody: "운영 정보는 권한이 확인된 관리자에게만 표시됩니다.",
    login: "관리자 로그인",
    refreshing: "조회 중",
    refresh: "새로고침",
    updated: "마지막 확인",
    unavailable: "조회 불가",
    suppressed: "표본 보호",
    na: "N/A",
    measured: "측정됨",
    source: "출처",
    numerator: "분자",
    denominator: "분모",
    noData: "조회 조건을 입력하면 집계 결과가 표시됩니다.",
    scope: "조회 범위",
    creatorId: "셀럽 ID",
    brandId: "브랜드 ID",
    liveId: "라이브 ID (선택)",
    from: "시작",
    to: "종료",
    apply: "분석 조회",
    invalidScope: "올바른 UUID와 시작·종료 시각을 입력하세요.",
    jobsTitle: "민팅 작업",
    jobsBody: "실패 또는 재시도 상태를 확인합니다.",
    auditTitle: "감사 기록",
    auditBody: "최근 운영 변경 기록의 조회 가능 여부를 확인합니다.",
    healthyJobs: "최근 조회 범위에 실패한 작업이 없습니다.",
    warningJobs: "실패 또는 재시도 중인 작업이 있습니다.",
    auditReady: "최근 감사 기록을 조회할 수 있습니다.",
    partial: "일부 운영 데이터를 불러오지 못했습니다.",
  },
  en: {
    overview: "Operations",
    analytics: "Analytics",
    creator: "Creator",
    brand: "Brand",
    content: "Celebrity content",
    jobs: "Blockchain jobs",
    audit: "Audit log",
    signedIn: "Active admin session",
    heading: "Operations requiring attention",
    headingBody:
      "Only facts returned by live operations APIs are shown. Missing values are never estimated.",
    dashboardHeading: "Performance analytics",
    dashboardBody:
      "Review scope and source together. Zero is measured; N/A and unavailable are distinct states.",
    loginTitle: "Admin sign-in required",
    loginBody: "Operations data is visible only to verified administrators.",
    login: "Admin sign in",
    refreshing: "Loading",
    refresh: "Refresh",
    updated: "Last checked",
    unavailable: "Unavailable",
    suppressed: "Privacy protected",
    na: "N/A",
    measured: "Measured",
    source: "Source",
    numerator: "Numerator",
    denominator: "Denominator",
    noData: "Enter a scope to load aggregate results.",
    scope: "Scope",
    creatorId: "Celebrity ID",
    brandId: "Brand ID",
    liveId: "Live ID (optional)",
    from: "From",
    to: "To",
    apply: "Run analysis",
    invalidScope: "Enter a valid UUID and a valid time window.",
    jobsTitle: "Minting jobs",
    jobsBody: "Checks for failed or retrying work.",
    auditTitle: "Audit trail",
    auditBody: "Checks whether recent operational changes are available.",
    healthyJobs: "No failed jobs in the returned range.",
    warningJobs: "Some jobs are failed or retrying.",
    auditReady: "Recent audit records are available.",
    partial: "Some operations data could not be loaded.",
  },
} as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const local = (value: Date) =>
    new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  return { from: local(from), to: local(to) };
}

async function authorizedJson<T>(
  url: string,
  getAccessToken: () => Promise<string | null>,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("UNAUTHENTICATED");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(body?.error?.code ?? `HTTP_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function AdminOverview({ locale = "ko" }: { locale?: Locale }) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const [state, setState] = useState<
    LoadState<{
      jobs: { failed: number; retrying: number } | null;
      auditCount: number | null;
      errors: string[];
    }>
  >({ status: "loading" });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      const [jobsResult, auditResult] = await Promise.allSettled([
        authorizedJson<{ jobs: Array<{ status?: string }> }>(
          "/api/admin/blockchain-jobs?limit=100",
          getAccessToken,
          signal,
        ),
        authorizedJson<{ items: unknown[] }>(
          "/api/admin/audit-logs?limit=10",
          getAccessToken,
          signal,
        ),
      ]);
      if (signal?.aborted) return;
      const jobs =
        jobsResult.status === "fulfilled"
          ? {
              failed: jobsResult.value.jobs.filter(
                (job) => job.status === "FAILED",
              ).length,
              retrying: jobsResult.value.jobs.filter(
                (job) => job.status === "RETRYING",
              ).length,
            }
          : null;
      const auditCount =
        auditResult.status === "fulfilled"
          ? auditResult.value.items.length
          : null;
      const errors = [jobsResult, auditResult].flatMap((result) =>
        result.status === "rejected"
          ? [
              result.reason instanceof Error
                ? result.reason.message
                : "UNAVAILABLE",
            ]
          : [],
      );
      setState({
        status: "ready",
        data: { jobs, auditCount, errors },
        refreshedAt: new Date().toISOString(),
      });
    },
    [getAccessToken],
  );
  useEffect(() => {
    if (session.status !== "authorized") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, session.status]);
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  const t = copy[locale];
  const ready = state.status === "ready" ? state : null;
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.heading}>
        <div>
          <p>{t.overview}</p>
          <h1>{t.heading}</h1>
          <span>{t.headingBody}</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.status === "loading"}
        >
          <RefreshCw aria-hidden="true" />
          {state.status === "loading" ? t.refreshing : t.refresh}
        </button>
      </div>
      {state.status === "error" ? (
        <section className={styles.unavailable} role="status">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>{t.partial}</strong>
            <p>
              {t.unavailable} · {state.code}
            </p>
          </div>
        </section>
      ) : !ready ? (
        <div className={styles.skeleton} aria-label={t.refreshing}>
          <span />
          <span />
        </div>
      ) : (
        <>
          <p className={styles.refreshed}>
            <CalendarClock aria-hidden="true" />
            {t.updated}{" "}
            <time dateTime={ready.refreshedAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(ready.refreshedAt))}
            </time>
          </p>
          {ready.data.errors.length > 0 && (
            <section className={styles.unavailable} role="status">
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>{t.partial}</strong>
                <p>
                  {t.unavailable} · {ready.data.errors.join(", ")}
                </p>
              </div>
            </section>
          )}
          <div className={styles.operations}>
            {ready.data.jobs ? (
              <section
                className={
                  ready.data.jobs.failed + ready.data.jobs.retrying > 0
                    ? styles.warning
                    : styles.operation
                }
              >
                <Blocks aria-hidden="true" />
                <div>
                  <h2>{t.jobsTitle}</h2>
                  <p>
                    {ready.data.jobs.failed + ready.data.jobs.retrying > 0
                      ? t.warningJobs
                      : t.healthyJobs}
                  </p>
                  <dl>
                    <div>
                      <dt>FAILED</dt>
                      <dd>{ready.data.jobs.failed}</dd>
                    </div>
                    <div>
                      <dt>RETRYING</dt>
                      <dd>{ready.data.jobs.retrying}</dd>
                    </div>
                  </dl>
                  <Link href={"/admin/blockchain-jobs" as Route}>
                    {t.jobs}
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </div>
              </section>
            ) : (
              <section className={styles.operation}>
                <Blocks aria-hidden="true" />
                <div>
                  <h2>{t.jobsTitle}</h2>
                  <p>{t.unavailable}</p>
                </div>
              </section>
            )}
            <section className={styles.operation}>
              <Database aria-hidden="true" />
              <div>
                <h2>{t.auditTitle}</h2>
                <p>
                  {ready.data.auditCount === null
                    ? t.unavailable
                    : t.auditReady}
                </p>
                {ready.data.auditCount !== null && (
                  <dl>
                    <div>
                      <dt>
                        {locale === "ko"
                          ? "최근 조회 건수"
                          : "Records returned"}
                      </dt>
                      <dd>{ready.data.auditCount}</dd>
                    </div>
                  </dl>
                )}
                <Link href={"/admin/audit" as Route}>
                  {t.audit}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </AdminOperationsShell>
  );
}

function Metric({
  label,
  metric,
  locale,
  denominator,
}: {
  label: string;
  metric: MetricEnvelope<number>;
  locale: Locale;
  denominator?: number | null;
}) {
  const t = copy[locale];
  const display =
    metric.state === "available"
      ? String(metric.value ?? 0)
      : metric.state === "suppressed"
        ? t.suppressed
        : metric.state === "not_applicable"
          ? t.na
          : t.unavailable;
  return (
    <article className={styles.metric} data-state={metric.state}>
      <div>
        <h3>{label}</h3>
        <span>
          {metric.state === "available"
            ? t.measured
            : (metric.reason ?? metric.state)}
        </span>
      </div>
      <strong>{display}</strong>
      <p>
        {t.numerator}: {display}
      </p>
      {denominator !== undefined && (
        <p>
          {t.denominator}: {denominator === null ? t.unavailable : denominator}
        </p>
      )}
      <p>
        {t.source}: {metric.source ?? t.na}
      </p>
    </article>
  );
}
function RatioMetric({
  label,
  metric,
  locale,
}: {
  label: string;
  metric: MetricEnvelope<Ratio>;
  locale: Locale;
}) {
  const t = copy[locale],
    value = metric.state === "available" ? metric.value : null;
  return (
    <article className={styles.metric} data-state={metric.state}>
      <div>
        <h3>{label}</h3>
        <span>{metric.state === "available" ? t.measured : metric.reason}</span>
      </div>
      <strong>
        {value
          ? `${(value.rate * 100).toFixed(1)}%`
          : metric.state === "suppressed"
            ? t.suppressed
            : t.na}
      </strong>
      <p>
        {t.numerator}: {value?.numerator ?? t.na}
      </p>
      <p>
        {t.denominator}: {value?.denominator ?? t.na}
      </p>
      <p>
        {t.source}: {metric.source ?? t.na}
      </p>
    </article>
  );
}

export function AdminAnalytics({
  initialView = "creator",
  locale = "ko",
}: {
  initialView?: AnalyticsView;
  locale?: Locale;
}) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const [view, setView] = useState<AnalyticsView>(initialView);
  const initialWindow = useMemo(() => defaultWindow(), []);
  const [scope, setScope] = useState("");
  const [live, setLive] = useState("");
  const [from, setFrom] = useState(initialWindow.from);
  const [to, setTo] = useState(initialWindow.to);
  const [state, setState] = useState<
    LoadState<CreatorAnalytics | BrandAnalytics>
  >({ status: "idle" });
  const [validation, setValidation] = useState(false);
  const requestId = useRef(0);
  const t = copy[locale];
  const invalidScope = !uuidPattern.test(scope);
  const invalidLive = live !== "" && !uuidPattern.test(live);
  const invalidWindow = !from || !to || new Date(from) >= new Date(to);
  const changeView = (next: AnalyticsView) => {
    requestId.current += 1;
    setView(next);
    setState({ status: "idle" });
    setValidation(false);
    window.history.replaceState(
      null,
      "",
      `/admin/dashboard?view=${next}${locale === "en" ? "&lang=en" : ""}`,
    );
  };
  const tabKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: AnalyticsView,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "creator"
        : event.key === "End"
          ? "brand"
          : current === "creator"
            ? "brand"
            : "creator";
    changeView(next);
    requestAnimationFrame(() =>
      document.getElementById(`analytics-tab-${next}`)?.focus(),
    );
  };
  const load = async () => {
    if (invalidScope || invalidLive || invalidWindow) {
      setValidation(true);
      return;
    }
    const currentRequest = ++requestId.current;
    setValidation(false);
    setState({ status: "loading" });
    const params = new URLSearchParams({
      [view === "creator" ? "celebrity" : "brand"]: scope,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      asOf: new Date().toISOString(),
    });
    if (live) params.set("live", live);
    try {
      const data = await authorizedJson<CreatorAnalytics | BrandAnalytics>(
        `/api/admin/analytics/${view}?${params}`,
        getAccessToken,
      );
      if (requestId.current === currentRequest)
        setState({
          status: "ready",
          data,
          refreshedAt: new Date().toISOString(),
        });
    } catch (error) {
      if (requestId.current === currentRequest)
        setState({
          status: "error",
          code: error instanceof Error ? error.message : "UNAVAILABLE",
        });
    }
  };
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.heading}>
        <div>
          <p>{t.analytics}</p>
          <h1>{t.dashboardHeading}</h1>
          <span>{t.dashboardBody}</span>
        </div>
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t.analytics}>
        <button
          id="analytics-tab-creator"
          type="button"
          role="tab"
          aria-selected={view === "creator"}
          aria-controls="analytics-panel"
          tabIndex={view === "creator" ? 0 : -1}
          onKeyDown={(event) => tabKey(event, "creator")}
          onClick={() => changeView("creator")}
        >
          {t.creator}
        </button>
        <button
          id="analytics-tab-brand"
          type="button"
          role="tab"
          aria-selected={view === "brand"}
          aria-controls="analytics-panel"
          tabIndex={view === "brand" ? 0 : -1}
          onKeyDown={(event) => tabKey(event, "brand")}
          onClick={() => changeView("brand")}
        >
          {t.brand}
        </button>
      </div>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <h2>{t.scope}</h2>
        <div className={styles.filterGrid}>
          <label>
            <span>{view === "creator" ? t.creatorId : t.brandId}</span>
            <input
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              aria-invalid={validation && invalidScope}
              aria-describedby={
                validation && invalidScope ? "analytics-scope-error" : undefined
              }
              placeholder="00000000-0000-4000-8000-000000000000"
            />
          </label>
          <label>
            <span>{t.liveId}</span>
            <input
              value={live}
              onChange={(event) => setLive(event.target.value)}
              aria-invalid={validation && invalidLive}
              aria-describedby={
                validation && invalidLive ? "analytics-scope-error" : undefined
              }
              placeholder="00000000-0000-4000-8000-000000000000"
            />
          </label>
          <label>
            <span>{t.from}</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-invalid={validation && invalidWindow}
              aria-describedby={
                validation && invalidWindow
                  ? "analytics-scope-error"
                  : undefined
              }
            />
          </label>
          <label>
            <span>{t.to}</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-invalid={validation && invalidWindow}
              aria-describedby={
                validation && invalidWindow
                  ? "analytics-scope-error"
                  : undefined
              }
            />
          </label>
        </div>
        {validation && (
          <p
            id="analytics-scope-error"
            className={styles.formError}
            role="alert"
          >
            {t.invalidScope}
          </p>
        )}
        <button type="submit" disabled={state.status === "loading"}>
          <BarChart3 aria-hidden="true" />
          {state.status === "loading" ? t.refreshing : t.apply}
        </button>
      </form>
      <div
        id="analytics-panel"
        role="tabpanel"
        aria-labelledby={`analytics-tab-${view}`}
        tabIndex={0}
      >
        {state.status === "idle" && (
          <section className={styles.empty}>
            <BarChart3 aria-hidden="true" />
            <p>{t.noData}</p>
          </section>
        )}
        {state.status === "loading" && (
          <div className={styles.skeleton} aria-label={t.refreshing}>
            <span />
            <span />
          </div>
        )}
        {state.status === "error" && (
          <section className={styles.unavailable} role="status">
            <CircleAlert aria-hidden="true" />
            <div>
              <strong>{t.unavailable}</strong>
              <p>{state.code}</p>
            </div>
          </section>
        )}
        {state.status === "ready" && (
          <AnalyticsResults data={state.data} view={view} locale={locale} />
        )}
      </div>
    </AdminOperationsShell>
  );
}

function AnalyticsResults({
  data,
  view,
  locale,
}: {
  data: CreatorAnalytics | BrandAnalytics;
  view: AnalyticsView;
  locale: Locale;
}) {
  const t = copy[locale];
  if (view === "brand") {
    const funnel = (data as BrandAnalytics).funnel;
    return (
      <section className={styles.results} aria-live="polite">
        <AnalyticsHeader
          data={data}
          locale={locale}
          title={
            locale === "ko" ? "브랜드 참여 퍼널" : "Brand engagement funnel"
          }
        />
        <div className={styles.metricGrid}>
          <Metric
            label={locale === "ko" ? "예약 참여" : "Reservation participations"}
            metric={funnel.reservationCount}
            locale={locale}
          />
          <Metric
            label={locale === "ko" ? "출석 참여" : "Attendance participations"}
            metric={funnel.attendanceCount}
            locale={locale}
          />
          <RatioMetric
            label={
              locale === "ko" ? "예약 대비 출석률" : "Attendance / reservations"
            }
            metric={funnel.attendanceRate}
            locale={locale}
          />
          <Metric
            label={locale === "ko" ? "제출 설문" : "Submitted surveys"}
            metric={funnel.surveyResponseCount}
            locale={locale}
          />
          <RatioMetric
            label={
              locale === "ko" ? "출석 대비 설문 완료율" : "Survey / attendance"
            }
            metric={funnel.surveyCompletionRate}
            locale={locale}
          />
          <Metric
            label={locale === "ko" ? "수동 구매" : "Manual commerce"}
            metric={funnel.manualCommerce}
            locale={locale}
          />
        </div>
        <SurveyBreakdown metric={funnel.surveyAggregates} locale={locale} />
      </section>
    );
  }
  const metrics = (data as CreatorAnalytics).metrics;
  const levels = metrics.levelDistribution;
  const stamps = metrics.stampTypeCounts;
  return (
    <section className={styles.results} aria-live="polite">
      <AnalyticsHeader
        data={data}
        locale={locale}
        title={locale === "ko" ? "크리에이터 집계" : "Creator aggregates"}
      />
      <div className={styles.metricGrid}>
        <Metric
          label={locale === "ko" ? "예약 참여" : "Reservation participations"}
          metric={metrics.reservationCount}
          locale={locale}
        />
        <Metric
          label={locale === "ko" ? "출석 참여" : "Attendance participations"}
          metric={metrics.attendanceCount}
          locale={locale}
        />
        <RatioMetric
          label={
            locale === "ko" ? "예약 대비 출석률" : "Attendance / reservations"
          }
          metric={metrics.attendanceRate}
          locale={locale}
        />
        <Metric
          label={locale === "ko" ? "제출 설문" : "Submitted surveys"}
          metric={metrics.surveyResponseCount}
          locale={locale}
        />
        <RatioMetric
          label={
            locale === "ko" ? "출석 대비 설문 완료율" : "Survey / attendance"
          }
          metric={metrics.surveyCompletionRate}
          locale={locale}
        />
        <Metric
          label={locale === "ko" ? "발급 Passport" : "Passports issued"}
          metric={metrics.passportsIssued}
          locale={locale}
        />
      </div>
      <SurveyBreakdown metric={metrics.surveyAggregates} locale={locale} />
      <div className={styles.breakdowns}>
        <div className={styles.distribution}>
          <h3>{locale === "ko" ? "팬 레벨 분포" : "Fan level distribution"}</h3>
          {levels.state === "available" && levels.value ? (
            <dl>
              {(
                ["bronze", "silver", "gold", "platinum", "diamond"] as const
              ).map((level) => (
                <div key={level}>
                  <dt>{level}</dt>
                  <dd>
                    {levels.value![level]} / {levels.value!.total}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{levels.state === "not_applicable" ? t.na : t.unavailable}</p>
          )}
          <p>
            {t.source}: {levels.source ?? t.na} · snapshot{" "}
            {levels.snapshotAt ?? data.window.asOf}
          </p>
        </div>
        <div className={styles.distribution}>
          <h3>{locale === "ko" ? "Stamp 유형" : "Stamp types"}</h3>
          {stamps.state === "available" && stamps.value ? (
            <dl>
              {(
                ["knowledge", "reservation", "attendance", "survey"] as const
              ).map((stamp) => (
                <div key={stamp}>
                  <dt>{stamp}</dt>
                  <dd>
                    {stamps.value![stamp]} / {stamps.value!.total}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{stamps.state === "not_applicable" ? t.na : t.unavailable}</p>
          )}
          <p>
            {t.source}: {stamps.source ?? t.na}
          </p>
        </div>
      </div>
    </section>
  );
}

function AnalyticsHeader({
  data,
  locale,
  title,
}: {
  data: CreatorAnalytics | BrandAnalytics;
  locale: Locale;
  title: string;
}) {
  const t = copy[locale];
  return (
    <header>
      <div>
        <h2>{title}</h2>
        <p>
          {data.window.semantics} ·{" "}
          {new Date(data.window.from).toLocaleDateString(locale)} –{" "}
          {new Date(data.window.to).toLocaleDateString(locale)}
        </p>
      </div>
      <time dateTime={data.window.asOf}>
        {t.updated} {new Date(data.window.asOf).toLocaleTimeString(locale)}
      </time>
    </header>
  );
}
function SurveyBreakdown({
  metric,
  locale,
}: {
  metric: MetricEnvelope<SurveyAggregates>;
  locale: Locale;
}) {
  const t = copy[locale],
    value = metric.state === "available" ? metric.value : null;
  return (
    <div className={styles.distribution}>
      <h3>
        {locale === "ko" ? "설문 공통 문항 집계" : "Common survey aggregates"}
      </h3>
      {value ? (
        <dl>
          <div>
            <dt>{locale === "ko" ? "평균 만족도" : "Average rating"}</dt>
            <dd>
              {value.averageRating ?? t.na} / 5 ({value.ratingCount})
            </dd>
          </div>
          <div>
            <dt>{locale === "ko" ? "구매 의향 Yes" : "Purchase intent Yes"}</dt>
            <dd>
              {value.purchaseIntentRate === null
                ? t.na
                : `${(value.purchaseIntentRate * 100).toFixed(1)}%`}{" "}
              ({value.purchaseIntentYes}/{value.purchaseIntentAnswered})
            </dd>
          </div>
          <div>
            <dt>{locale === "ko" ? "향후 참여 Yes" : "Future interest Yes"}</dt>
            <dd>
              {value.futureInterestRate === null
                ? t.na
                : `${(value.futureInterestRate * 100).toFixed(1)}%`}{" "}
              ({value.futureInterestYes}/{value.futureInterestAnswered})
            </dd>
          </div>
        </dl>
      ) : (
        <p>
          {metric.state === "suppressed"
            ? `${t.suppressed} · ${metric.reason}`
            : (metric.reason ?? t.na)}
        </p>
      )}
      <p>
        {t.source}: {metric.source ?? t.na}
      </p>
    </div>
  );
}
