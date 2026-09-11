"use client";

import { MyLiveCountdown } from "@/features/my/ui/my-live-countdown";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Eye, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import type { LiveEventResponse } from "../domain/live-event";
import { FanHeading } from "../../../components/fan-ui/fan-heading";
import styles from "./live-catalog-screen.module.css";
import { LiveStatusIndicator } from "@/components/live-status-indicator";
import { ObservedLiveStrip } from "./observed-live-strip";

type Catalog = {
  liveNow: readonly LiveEventResponse[];
  upcoming: readonly LiveEventResponse[];
  replay: readonly LiveEventResponse[];
};

const CATALOG_PAGE_SIZE = 4;

const copy = {
  ko: {
    title: "전체 LIVE",
    intro: "지금 진행 중인 LIVE에 참여하고, 예정된 LIVE를 예약하거나 다시보기를 시청해 보세요.",
    liveNow: "지금 LIVE 중",
    upcoming: "예정된 LIVE",
    replay: "다시보기",
    emptyAll: "현재 공개된 LIVE가 없어요.",
    emptyLive: "현재 진행 중인 LIVE가 없어요.",
    emptyUpcoming: "예정된 LIVE가 없어요.",
    emptyReplay: "공개된 다시보기가 없어요.",
    enter: "LIVE 시청하기",
    reserve: "라이브 예약하기",
    reserved: "예약 완료",
    details: "상세 보기",
    reservationLoading: "예약 상태 확인 중",
    reservationUnknown: "예약 상태 확인 필요",
    watch: "다시보기",
    retry: "내 예약 상태 다시 불러오기",
    calendar: "LIVE 캘린더",
  },
  en: {
    title: "All LIVE events",
    intro: "Join what is live now, reserve the next moment, or revisit a past LIVE.",
    liveNow: "LIVE NOW",
    upcoming: "Upcoming LIVE",
    replay: "Replay",
    emptyAll: "No LIVE event is published right now.",
    emptyLive: "Nothing is live right now.",
    emptyUpcoming: "No upcoming LIVE events.",
    emptyReplay: "No replays are published yet.",
    enter: "Enter LIVE",
    reserve: "Reserve LIVE",
    reserved: "Reserved",
    details: "View details",
    reservationLoading: "Checking reservation status",
    reservationUnknown: "Reservation status unavailable",
    watch: "Watch replay",
    retry: "Reload my reservation status",
    calendar: "LIVE calendar",
  },
} as const;

function dateRange(item: LiveEventResponse, locale: FanLocale) {
  const startsAt = new Date(item.live.startsAt);
  const endsAt = new Date(item.live.endsAt);
  const formatter = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: locale === "ko" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: locale !== "ko",
    timeZone: "Asia/Seoul",
  });
  const sameDay = startsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
    === endsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (sameDay) {
    const endTime = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      hour: locale === "ko" ? "2-digit" : "numeric",
      minute: "2-digit",
      hour12: locale !== "ko",
      timeZone: "Asia/Seoul",
    }).format(endsAt);
    return `${formatter.format(startsAt)}–${endTime}`;
  }
  return `${formatter.format(startsAt)} – ${formatter.format(endsAt)}`;
}

function action(item: LiveEventResponse, locale: FanLocale) {
  const t = copy[locale];
  if (item.live.effectiveStatus === "live") return { label: t.enter, icon: <Play />, external: true, state: "watch" as const };
  if (item.live.effectiveStatus === "ended") return { label: t.watch, icon: <Play />, external: true, state: "watch" as const };
  if (item.viewer.reservation) return { label: t.details, icon: <Eye />, external: false, state: "reserved" as const };
  return { label: t.details, icon: <Eye />, external: false, state: "reserve" as const };
}

function LiveGroup({
  id,
  title,
  empty,
  items,
  locale,
  reservationStatus,
  onStartReached,
}: {
  id: string;
  title: string;
  empty: string;
  items: readonly LiveEventResponse[];
  locale: FanLocale;
  reservationStatus: "loading" | "ready" | "error";
  onStartReached: () => void;
}) {
  const t = copy[locale];
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / CATALOG_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = items.slice(
    currentPage * CATALOG_PAGE_SIZE,
    (currentPage + 1) * CATALOG_PAGE_SIZE,
  );
  return (
    <section className={styles.group} data-empty={items.length === 0} aria-labelledby={`${id}-heading`}>
      <header className={styles.groupHeader}>
        <FanHeading id={`${id}-heading`}>{title}</FanHeading>
        {items.length > 0 ? <span className={styles.count} aria-label={`${title} ${items.length}${locale === "ko" ? "개" : " total"}`}>{items.length}</span> : null}
      </header>
      {items.length ? (
        <div className={styles.list}>
          {visibleItems.map((item) => {
            const currentAction = action(item, locale);
            const awaitsReservation = item.live.effectiveStatus === "scheduled" && reservationStatus !== "ready";
            const isReserved = item.live.effectiveStatus === "scheduled" && reservationStatus === "ready" && Boolean(item.viewer.reservation);
            const href = currentAction.external
              ? item.live.watch.url
              : `/live/${item.live.slug}?locale=${locale}`;
            return (
              <article className={styles.row} key={item.live.id}>
                <CreatorAvatar slug={item.live.celebrity.slug} src={item.live.celebrity.image} photos={item.live.celebrity.photos} position={item.live.celebrity.imagePosition} size={{ mobile: 52, desktop: 64 }} />
                <Link
                  className={styles.details}
                  href={`/live/${item.live.slug}?locale=${locale}` as Route}
                  aria-label={
                    locale === "ko"
                      ? `${item.live.title} 상세 보기`
                      : `View ${item.live.title} details`
                  }
                >
                  <div className={styles.meta}>
                    <span className={styles.creatorName}>{item.live.celebrity.name}{item.live.brand.name.trim().toLowerCase() === "byus" ? "" : ` · ${item.live.brand.name}`}</span>
                    {isReserved ? <span className={styles.reservationStatus}><CircleCheck aria-hidden="true" />{t.reserved}</span> : null}
                    {item.live.effectiveStatus === "live" ? (
                      <LiveStatusIndicator
                        density="compact"
                        locale={locale}
                        status={item.live.effectiveStatus}
                      />
                    ) : null}
                  </div>
                  <h3>{item.live.title}</h3>
                  <div className={styles.schedule}>
                    <time className={styles.dateRange} dateTime={item.live.startsAt}>{dateRange(item, locale)}</time>
                    {item.live.effectiveStatus === "scheduled" ? <MyLiveCountdown event={item.live} locale={locale} pulseScheduled onStartReached={onStartReached} /> : null}
                  </div>
                </Link>
                {awaitsReservation ? reservationStatus === "loading" ? (
                  <span className={styles.actionSkeleton} role="status" aria-label={t.reservationLoading}>
                    <span className={styles.srOnly}>{t.reservationLoading}</span>
                  </span>
                ) : (
                  <span className={styles.actionUnavailable} role="status" aria-label={t.reservationUnknown}>
                    <CalendarDays aria-hidden="true" />
                    <span>{t.reservationUnknown}</span>
                  </span>
                ) : (
                  <Link
                    className={styles.action}
                    data-action-state={currentAction.state}
                    data-fan-action-emphasis="secondary"
                    href={href as Route}
                    target={currentAction.external ? "_blank" : undefined}
                    rel={currentAction.external ? "noreferrer" : undefined}
                    aria-label={`${currentAction.label}: ${item.live.title}${currentAction.external ? locale === "ko" ? ", 새 창" : ", new tab" : ""}`}
                  >
                    <span className={styles.actionIcon} aria-hidden="true">{currentAction.icon}</span>
                    <span className={styles.actionLabel}>{currentAction.label}</span>
                    {currentAction.external ? <span className={styles.srOnly}>새 창</span> : null}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      ) : <p className={styles.empty}>{empty}</p>}
      {pageCount > 1 ? (
        <nav className={styles.pagination} aria-label={locale === "ko" ? `${title} 페이지` : `${title} pages`}>
          <button
            type="button"
            aria-label={locale === "ko" ? `${title} 이전 페이지` : `Previous ${title} page`}
            disabled={currentPage === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span aria-live="polite" aria-atomic="true">{currentPage + 1} / {pageCount}</span>
          <button
            type="button"
            aria-label={locale === "ko" ? `${title} 다음 페이지` : `Next ${title} page`}
            disabled={currentPage === pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

export function LiveCatalogScreen({
  initialCatalog,
  locale,
}: {
  initialCatalog: Catalog;
  locale: FanLocale;
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [failed, setFailed] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const refreshLiveStatus = useCallback(() => setRequestKey(value => value + 1), []);
  const [reservationStatus, setReservationStatus] = useState<"loading" | "ready" | "error">(
    !ready || authenticated ? "loading" : "ready",
  );
  const t = copy[locale];

  useEffect(() => {
    if (!ready) {
      setReservationStatus("loading");
      return;
    }
    if (!authenticated && requestKey === 0) {
      setCatalog(initialCatalog);
      setReservationStatus("ready");
      return;
    }
    const controller = new AbortController();
    setFailed(false);
    setReservationStatus("loading");
    void (async () => {
      try {
        const token = authenticated ? await getAccessToken() : null;
        if (authenticated && !token) throw new Error("access token unavailable");
        const response = await fetch(`/api/live-events?locale=${locale}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("catalog request failed");
        const body = await response.json() as { catalog: Catalog };
        setCatalog(body.catalog);
        setReservationStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          setReservationStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [ready, authenticated, getAccessToken, locale, requestKey, initialCatalog]);

  const total = catalog.liveNow.length + catalog.upcoming.length + catalog.replay.length;
  return (
    <FanAppFrame locale={locale} mainId="live-catalog-main">
      <FanContentContainer as="main" className={styles.main} id="live-catalog-main" tabIndex={-1}>
        <header className={styles.intro}>
          <div>
            <FanHeading as="h1">{t.title}</FanHeading>
            <p>{t.intro}</p>
          </div>
          <Link className={styles.calendarLink} href={`/live/calendar?locale=${locale}` as Route}>
            <CalendarDays aria-hidden="true" />
            {t.calendar}
          </Link>
        </header>
        <ObservedLiveStrip locale={locale} />
        {failed ? <button className={styles.retry} onClick={() => setRequestKey((value) => value + 1)}><RotateCcw />{t.retry}</button> : null}
        {total === 0 ? <p className={styles.emptyAll}>{t.emptyAll}</p> : (
          <>
            {catalog.liveNow.length > 0 ? <LiveGroup id="live-now" title={t.liveNow} empty={t.emptyLive} items={catalog.liveNow} locale={locale} reservationStatus={reservationStatus} onStartReached={refreshLiveStatus} /> : null}
            <LiveGroup id="upcoming" title={t.upcoming} empty={t.emptyUpcoming} items={catalog.upcoming} locale={locale} reservationStatus={reservationStatus} onStartReached={refreshLiveStatus} />
            <LiveGroup id="replay" title={t.replay} empty={t.emptyReplay} items={catalog.replay} locale={locale} reservationStatus={reservationStatus} onStartReached={refreshLiveStatus} />
          </>
        )}
      </FanContentContainer>
    </FanAppFrame>
  );
}
