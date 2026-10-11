"use client";

import { usePrivy } from "@privy-io/react-auth";
import { CircleAlert, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { AdminLocale } from "../../../components/admin/operations-shell";
import { useAdminSession } from "../../../components/admin/use-admin-session";
import {
  outboundAnalyticsSchema,
  type OutboundAnalyticsData,
} from "../domain/outbound-analytics";
import base from "./admin-overview-dashboard.module.css";
import styles from "./web-analytics-dashboard.module.css";

type Days = 7 | 30 | 90;
type State =
  | { status: "loading" }
  | { status: "ready"; owner: string; data: OutboundAnalyticsData }
  | { status: "error" | "unauthenticated" | "denied" };

const number = (value: number, locale: AdminLocale) =>
  new Intl.NumberFormat(locale).format(value);

const placementLabels = {
  fanpage_hero: { ko: "팬페이지 히어로", en: "Fan page hero" },
  header: { ko: "헤더", en: "Header" },
  footer: { ko: "푸터", en: "Footer" },
  content: { ko: "콘텐츠", en: "Content" },
} as const;

const kindLabels = {
  ticket: { ko: "예매·참가 신청", en: "Tickets & registration" },
  website: { ko: "웹사이트", en: "Website" },
  social: { ko: "소셜", en: "Social" },
  external: { ko: "외부 링크", en: "External link" },
} as const;

export function OutboundAnalyticsContent({
  data,
  locale,
}: {
  data: OutboundAnalyticsData;
  locale: AdminLocale;
}) {
  const ko = locale === "ko";
  return (
    <section className={`${base.panel} ${styles.outbound}`} aria-labelledby="outbound-title">
      <div className={base.panelHeading}>
        <div>
          <h2 id="outbound-title">{ko ? "외부 링크 클릭" : "Outbound link clicks"}</h2>
          <p>{ko ? "캠페인과 목적지별 익명 클릭 흐름" : "Anonymous click activity by campaign and destination"}</p>
        </div>
        <ExternalLink aria-hidden="true" />
      </div>
      <div className={styles.outboundMetrics}>
        <div><span>{ko ? "클릭" : "Clicks"}</span><strong>{number(data.totals.clicks, locale)}</strong></div>
        <div><span>{ko ? "세션" : "Sessions"}</span><strong>{number(data.totals.sessions, locale)}</strong></div>
      </div>
      {data.rows.length === 0 ? (
        <p className={styles.empty}>{ko ? "이 기간에 기록된 외부 링크 클릭이 없습니다." : "No outbound link clicks were recorded in this period."}</p>
      ) : (
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={ko ? "외부 링크 클릭 상세 목록" : "Outbound link click details"}>
          <table className={`${styles.table} ${styles.outboundTable}`}>
            <thead><tr>
              <th scope="col">{ko ? "캠페인" : "Campaign"}</th>
              <th scope="col">{ko ? "목적지 도메인" : "Destination host"}</th>
              <th scope="col">{ko ? "위치" : "Placement"}</th>
              <th scope="col">{ko ? "종류" : "Type"}</th>
              <th scope="col">{ko ? "클릭" : "Clicks"}</th>
              <th scope="col">{ko ? "세션" : "Sessions"}</th>
            </tr></thead>
            <tbody>{data.rows.map((row, index) => <tr key={`${row.campaign}:${row.destinationHost}:${row.placement}:${row.linkKind}:${index}`}>
              <th scope="row">{row.campaign}</th>
              <td>{row.destinationHost}</td>
              <td>{placementLabels[row.placement][locale]}</td>
              <td>{kindLabels[row.linkKind][locale]}</td>
              <td>{number(row.clicks, locale)}</td>
              <td>{number(row.sessions, locale)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {data.truncated && <p className={styles.truncated}>{ko ? "상위 100개 항목만 표시합니다." : "Showing the top 100 rows."}</p>}
      <p className={styles.measurementNote}>
        {ko
          ? "세션은 같은 브라우저 탭에서 이어진 익명 방문 단위이며 사람 수나 구매 건수가 아닙니다. 구매 완료와 컨텍스트 메뉴로 연 클릭은 측정하지 않습니다."
          : "A session is an anonymous visit within the same browser tab, not a person or purchase count. Completed purchases and links opened from a context menu are not measured."}
      </p>
    </section>
  );
}

export function OutboundAnalytics({
  days,
  refresh,
  locale,
}: {
  days: Days;
  refresh: number;
  locale: AdminLocale;
}) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const owner = session.status === "authorized" ? session.admin.email : null;
  const ko = locale === "ko";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (session.status !== "authorized") return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (controller.signal.aborted) return;
        if (!token) { setState({ status: "unauthenticated" }); return; }
        const response = await fetch(`/api/admin/analytics/outbound?days=${days}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setState({ status: response.status === 401 ? "unauthenticated" : "denied" });
          return;
        }
        if (!response.ok) { setState({ status: "error" }); return; }
        const data = outboundAnalyticsSchema.parse(await response.json());
        if (!controller.signal.aborted) setState({ status: "ready", owner: owner ?? "", data });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [session.status, owner, getAccessToken, days, refresh]);

  if (session.status !== "authorized") return null;
  const visible: State = state.status === "ready" && (state.owner !== owner || state.data.days !== days)
    ? { status: "loading" }
    : state;
  if (visible.status === "ready") return <OutboundAnalyticsContent data={visible.data} locale={locale} />;
  if (visible.status === "loading") return <section className={base.loading} role="status"><div className={base.skeletonChart} /><span>{ko ? "외부 링크 집계를 불러오고 있습니다." : "Loading outbound link analytics…"}</span></section>;
  return <section className={styles.outboundError} role="alert"><CircleAlert aria-hidden="true" /><div><h2>{ko ? "외부 링크 집계를 불러오지 못했습니다" : "Could not load outbound link analytics"}</h2><p>{visible.status === "denied" ? (ko ? "이 집계를 볼 권한이 없습니다." : "You do not have access to this report.") : visible.status === "unauthenticated" ? (ko ? "관리자 로그인이 만료되었습니다." : "Your admin session has expired.") : (ko ? "방문 통계와 별개로 잠시 사용할 수 없습니다." : "This report is temporarily unavailable; web traffic remains available.")}</p></div></section>;
}
