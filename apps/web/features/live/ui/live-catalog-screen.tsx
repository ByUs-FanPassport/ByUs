"use client";

import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__live__ui__live-catalog-screen";
import { additionalLocales, translate } from "@/i18n/messages";
import { MyLiveCountdown } from "@/features/my/ui/my-live-countdown";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";

import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Eye, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import type { LiveEventResponse } from "../domain/live-event";
import { nearestRecurringLives } from "../domain/nearest-recurring-lives";
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
    intro: "지금 진행 중인 LIVE에 참여하고, 예정된 LIVE를 예약해 보세요.",
    liveNow: "지금 LIVE 중",
    upcoming: "예정된 LIVE",
    emptyAll: "현재 공개된 LIVE가 없어요.",
    emptyLive: "현재 진행 중인 LIVE가 없어요.",
    emptyUpcoming: "예정된 LIVE가 없어요.",
    enter: "LIVE 시청하기",
    reserve: "라이브 예약하기",
    reserved: "예약 완료",
    details: "상세 보기",
    reservationLoading: "예약 상태 확인 중",
    reservationUnknown: "예약 상태 확인 필요",
    retry: "내 예약 상태 다시 불러오기",
    calendar: "LIVE 캘린더",
  },
  en: {
    title: "All LIVE events",
    intro: "Join a LIVE happening now or reserve a spot for an upcoming LIVE.",
    liveNow: "LIVE NOW",
    upcoming: "Upcoming LIVE",
    emptyAll: "There are no published LIVE events right now.",
    emptyLive: "Nothing is live right now.",
    emptyUpcoming: "No upcoming LIVE events.",
    enter: "Watch LIVE",
    reserve: "Reserve a spot",
    reserved: "Reserved",
    details: "View details",
    reservationLoading: "Checking reservation status",
    reservationUnknown: "Reservation status unavailable",
    retry: "Reload my reservation status",
    calendar: "LIVE calendar",
  },

  ...additionalLocales((translationLocale) => ({
    title: localizedMessages.m5512385f3f65[translationLocale],
    intro: localizedMessages.mb2a27553073c[translationLocale],
    liveNow: localizedMessages.m9a88574728d8[translationLocale],
    upcoming: localizedMessages.me0f2d726baad[translationLocale],
    emptyAll: localizedMessages.mb058a008daea[translationLocale],
    emptyLive: localizedMessages.m595ca556cf42[translationLocale],
    emptyUpcoming: localizedMessages.mba1a7b5ea2be[translationLocale],
    enter: localizedMessages.m47b6bd7a8c1e[translationLocale],
    reserve: localizedMessages.m83d238865329[translationLocale],
    reserved: localizedMessages.m96b86c41e168[translationLocale],
    details: localizedMessages.me8e8e7dcc7cd[translationLocale],
    reservationLoading: localizedMessages.m3829bffc17b9[translationLocale],
    reservationUnknown: localizedMessages.mfff75b1c1b3e[translationLocale],
    retry: localizedMessages.m9a2c16305724[translationLocale],
    calendar: localizedMessages.me243583851df[translationLocale],
  }))
} as const;

function dateRange(item: LiveEventResponse, locale: FanLocale) {
  const startsAt = new Date(item.live.startsAt);
  const formatter = new Intl.DateTimeFormat(locale, { calendar: "gregory",
    month: "short",
    day: "numeric",
    hour: locale === "ko" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: locale === "ko" ? false : locale === "en" ? true : undefined,
    timeZone: "Asia/Seoul",
  });
  if (item.live.endsAt === null) return `${formatter.format(startsAt)} · ${locale === "ko" ? "종료 시간 미정" : translate(locale, localizedMessages.m9203f81c207d, "End time unconfirmed")}`;
  const endsAt = new Date(item.live.endsAt);
  const sameDay = startsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
    === endsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (sameDay) {
    const endTime = new Intl.DateTimeFormat(locale, { calendar: "gregory",
      hour: locale === "ko" ? "2-digit" : "numeric",
      minute: "2-digit",
      hour12: locale === "ko" ? false : locale === "en" ? true : undefined,
      timeZone: "Asia/Seoul",
    }).format(endsAt);
    return `${formatter.format(startsAt)}–${endTime}`;
  }
  return `${formatter.format(startsAt)} – ${formatter.format(endsAt)}`;
}

function action(item: LiveEventResponse, locale: FanLocale) {
  const t = copy[locale];
  if (item.live.watch.mode === "replay" && item.live.watch.available) return { label: participationCopy(locale).replays, icon: <Play />, external: true, state: "watch" as const };
  if (item.live.effectiveStatus === "live") return { label: t.enter, icon: <Play />, external: true, state: "watch" as const };
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
  const groups = id === "upcoming" ? nearestRecurringLives(items) : items;
  const pageCount = Math.max(1, Math.ceil(groups.length / CATALOG_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = groups.slice(
    currentPage * CATALOG_PAGE_SIZE,
    (currentPage + 1) * CATALOG_PAGE_SIZE,
  );
  const renderRow = (item: LiveEventResponse) => {
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
                    locale === "ko" ? `${item.live.title} 상세 보기` : translate(locale, localizedMessages.m43c55b90f860, "View {0} details", [item.live.title])
                  }
                >
                  <div className={styles.meta}>
                    <span className={styles.creatorName}>{item.live.celebrity.name}{!item.live.brand || item.live.brand.name.trim().toLowerCase() === "byus" ? "" : ` · ${item.live.brand.name}`}</span>
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
                    aria-label={`${currentAction.label}: ${item.live.title}${currentAction.external ? locale === "ko" ? ", 새 창" : translate(locale, localizedMessages.mc8f56bef8619, ", new tab") : ""}`}
                  >
                    <span className={styles.actionIcon} aria-hidden="true">{currentAction.icon}</span>
                    <span className={styles.actionLabel}>{currentAction.label}</span>
                    {currentAction.external ? <span className={styles.srOnly}>새 창</span> : null}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                )}
              </article>
            );

  };
  return (
    <section className={styles.group} data-empty={items.length === 0} aria-labelledby={`${id}-heading`}>
      <header className={styles.groupHeader}>
        <FanHeading id={`${id}-heading`}>{title}</FanHeading>
        {items.length > 0 ? <span className={styles.count} aria-label={`${title} ${groups.length}${locale === "ko" ? "개" : translate(locale, localizedMessages.mb37052ce0f64, " total")}`}>{groups.length}</span> : null}
      </header>
      {items.length ? (
        <div className={styles.list}>
          {visibleItems.map(renderRow)}
        </div>
      ) : <p className={styles.empty}>{empty}</p>}
      {pageCount > 1 ? (
        <nav className={styles.pagination} aria-label={locale === "ko" ? `${title} 페이지` : translate(locale, localizedMessages.m3cfeb050544a, "{0} pages", [title])}>
          <button
            type="button"
            aria-label={locale === "ko" ? `${title} 이전 페이지` : translate(locale, localizedMessages.m505a78fdc660, "Previous {0} page", [title])}
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span aria-live="polite" aria-atomic="true">{currentPage + 1} / {pageCount}</span>
          <button
            type="button"
            aria-label={locale === "ko" ? `${title} 다음 페이지` : translate(locale, localizedMessages.mbd51832549e0, "Next {0} page", [title])}
            disabled={currentPage === pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
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
  const session = useByUsSession();
  const requestAuthenticated = ready && session.ready && authenticated;
  const [catalog, setCatalog] = useState(initialCatalog);
  const [failed, setFailed] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const refreshLiveStatus = useCallback(() => setRequestKey(value => value + 1), []);
  const [reservationStatus, setReservationStatus] = useState<"loading" | "ready" | "error">(
    !ready || requestAuthenticated ? "loading" : "ready",
  );
  const t = copy[locale];

  useEffect(() => {
    if (!ready) {
      setReservationStatus("loading");
      return;
    }
    if (!requestAuthenticated && requestKey === 0 && !session.pending) {
      setCatalog(initialCatalog);
      setReservationStatus("ready");
      return;
    }
    const controller = new AbortController();
    setFailed(false);
    setReservationStatus("loading");
    void (async () => {
      try {
        const token = requestAuthenticated ? await getAccessToken() : null;
        if (controller.signal.aborted) return;
        if (requestAuthenticated && !token) throw new Error("access token unavailable");
        const response = await fetch(`/api/live-events?locale=${toContentLocale(locale)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error("catalog request failed");
        const body = await response.json() as { catalog: Catalog };
        if (controller.signal.aborted) return;
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
  }, [ready, requestAuthenticated, getAccessToken, locale, requestKey, initialCatalog, session.generation, session.pending]);

  const replay = catalog.replay.filter(item => item.live.watch.available && item.live.watch.mode === "replay");
  const total = catalog.liveNow.length + catalog.upcoming.length + replay.length;
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
            {replay.length > 0 && <LiveGroup id="replay" title={participationCopy(locale).replays} empty={participationCopy(locale).empty} items={replay} locale={locale} reservationStatus={reservationStatus} onStartReached={refreshLiveStatus} />}
            <LiveGroup id="upcoming" title={t.upcoming} empty={t.emptyUpcoming} items={catalog.upcoming} locale={locale} reservationStatus={reservationStatus} onStartReached={refreshLiveStatus} />
          </>
        )}
      </FanContentContainer>
    </FanAppFrame>
  );
}
