"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Play, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import type { LiveEventResponse } from "../domain/live-event";
import { FanHeading, FanSectionHeader } from "../../../components/fan-ui/fan-heading";
import styles from "./live-catalog-screen.module.css";
import { LiveStatusIndicator } from "@/components/live-status-indicator";

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
    liveNowSub: "지금 바로 시청할 수 있어요.",
    upcoming: "예정된 LIVE",
    upcomingSub: "일정을 확인하고 LIVE를 예약해 보세요.",
    replay: "다시보기",
    replaySub: "종료된 LIVE의 공개 영상을 다시 시청할 수 있어요.",
    emptyAll: "현재 공개된 LIVE가 없어요.",
    emptyLive: "현재 진행 중인 LIVE가 없어요.",
    emptyUpcoming: "예정된 LIVE가 없어요.",
    emptyReplay: "공개된 다시보기가 없어요.",
    enter: "LIVE 시청하기",
    reserve: "라이브 예약하기",
    reserved: "예약 완료",
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
    liveNowSub: "Broadcasts you can enter right now.",
    upcoming: "Upcoming LIVE",
    upcomingSub: "Check the schedule and reserve your place.",
    replay: "Replay",
    replaySub: "Revisit published videos from completed LIVE events.",
    emptyAll: "No LIVE event is published right now.",
    emptyLive: "Nothing is live right now.",
    emptyUpcoming: "No upcoming LIVE events.",
    emptyReplay: "No replays are published yet.",
    enter: "Enter LIVE",
    reserve: "Reserve LIVE",
    reserved: "Reserved",
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
  if (item.viewer.reservation) return { label: t.reserved, icon: <CircleCheck />, external: false, state: "reserved" as const };
  return { label: t.reserve, icon: <CalendarDays />, external: false, state: "reserve" as const };
}

function statusLabel(item: LiveEventResponse, locale: FanLocale) {
  if (item.live.effectiveStatus === "live") return locale === "ko" ? "LIVE 진행 중" : "LIVE now";
  if (item.live.effectiveStatus === "scheduled") return locale === "ko" ? "LIVE 예정" : "Upcoming";
  return locale === "ko" ? "다시보기" : "Replay";
}

function LiveGroup({
  id,
  title,
  subtitle,
  empty,
  items,
  locale,
  reservationStatus,
}: {
  id: string;
  title: string;
  subtitle: string;
  empty: string;
  items: readonly LiveEventResponse[];
  locale: FanLocale;
  reservationStatus: "loading" | "ready" | "error";
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
    <section className={styles.group} aria-labelledby={`${id}-heading`}>
      <FanSectionHeader id={`${id}-heading`} title={title} description={subtitle} accessory={
        <span aria-label={`${title} ${items.length}${locale === "ko" ? "개" : ""}`}>
          {locale === "ko" ? `총 ${items.length}개` : `${items.length} total`}
        </span>
      } />
      {items.length ? (
        <div className={styles.list}>
          {visibleItems.map((item) => {
            const currentAction = action(item, locale);
            const awaitsReservation = item.live.effectiveStatus === "scheduled" && reservationStatus !== "ready";
            const href = currentAction.external
              ? item.live.watch.url
              : `/live/${item.live.slug}?locale=${locale}`;
            return (
              <article className={styles.row} key={item.live.id}>
                <Image
                  src={item.live.celebrity.image}
                  alt=""
                  width={64}
                  height={64}
                  unoptimized={item.live.celebrity.image.startsWith("https://")}
                />
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
                    <span>{item.live.celebrity.name} · {item.live.brand.name}</span>
                    {item.live.effectiveStatus === "live" ||
                    item.live.effectiveStatus === "scheduled" ? (
                      <LiveStatusIndicator
                        density="compact"
                        locale={locale}
                        status={item.live.effectiveStatus}
                      />
                    ) : (
                      <span>{statusLabel(item, locale)}</span>
                    )}
                  </div>
                  <h3>{item.live.title}</h3>
                  <p>{dateRange(item, locale)}</p>
                </Link>
                {awaitsReservation ? reservationStatus === "loading" ? (
                  <span className={styles.actionSkeleton} role="status" aria-label={t.reservationLoading}>
                    <span className={styles.srOnly}>{t.reservationLoading}</span>
                  </span>
                ) : (
                  <span className={styles.actionUnavailable} role="status">
                    <CalendarDays aria-hidden="true" />
                    <span>{t.reservationUnknown}</span>
                  </span>
                ) : (
                  <Link
                    className={styles.action}
                    data-action-state={currentAction.state}
                    data-fan-action-emphasis={currentAction.state === "reserve" ? "primary" : "secondary"}
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
  const [reservationStatus, setReservationStatus] = useState<"loading" | "ready" | "error">(
    !ready || authenticated ? "loading" : "ready",
  );
  const t = copy[locale];

  useEffect(() => {
    if (!ready) {
      setReservationStatus("loading");
      return;
    }
    if (!authenticated) {
      setReservationStatus("ready");
      return;
    }
    const controller = new AbortController();
    setFailed(false);
    setReservationStatus("loading");
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("access token unavailable");
        const response = await fetch(`/api/live-events?locale=${locale}`, {
          headers: { Authorization: `Bearer ${token}` },
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
  }, [ready, authenticated, getAccessToken, locale, requestKey]);

  const total = catalog.liveNow.length + catalog.upcoming.length + catalog.replay.length;
  return (
    <FanAppFrame locale={locale} mainId="live-catalog-main">
      <FanContentContainer as="main" className={styles.main} id="live-catalog-main" tabIndex={-1}>
        <header className={styles.intro}>
          <FanHeading as="h1">{t.title}</FanHeading>
          <p>{t.intro}</p>
        </header>
        <Link className={styles.calendarLink} href={`/live/calendar?locale=${locale}` as Route}>
          <CalendarDays aria-hidden="true" />
          {t.calendar}
        </Link>
        {failed ? <button className={styles.retry} onClick={() => setRequestKey((value) => value + 1)}><RotateCcw />{t.retry}</button> : null}
        {total === 0 ? <p className={styles.emptyAll}>{t.emptyAll}</p> : (
          <>
            {catalog.liveNow.length > 0 ? <LiveGroup id="live-now" title={t.liveNow} subtitle={t.liveNowSub} empty={t.emptyLive} items={catalog.liveNow} locale={locale} reservationStatus={reservationStatus} /> : null}
            <LiveGroup id="upcoming" title={t.upcoming} subtitle={t.upcomingSub} empty={t.emptyUpcoming} items={catalog.upcoming} locale={locale} reservationStatus={reservationStatus} />
            <LiveGroup id="replay" title={t.replay} subtitle={t.replaySub} empty={t.emptyReplay} items={catalog.replay} locale={locale} reservationStatus={reservationStatus} />
          </>
        )}
      </FanContentContainer>
    </FanAppFrame>
  );
}
