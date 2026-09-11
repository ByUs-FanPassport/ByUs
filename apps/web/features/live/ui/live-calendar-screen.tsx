"use client";

import type { PhotoSet } from "@/features/media/domain/public-image";
import { CalendarArt } from "@/components/fan-calendar/calendar-art";
import { Dialog } from "@/components/ui/overlay/accessible-overlay";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";
import { CreatorImage } from "@/components/fan-ui/creator-image";

import { LiveStatusIndicator } from "@/components/live-status-indicator";

import { usePrivy } from "@privy-io/react-auth";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { CalendarDayNumber, CalendarMonthHeader } from "../../../components/fan-calendar/calendar-parts";
import { FanMotionIcon } from "../../../components/fan-ui/fan-motion-icon";
import { liveCalendarMonthSchema, type LiveCalendarMonth } from "../domain/live-calendar";
import type { ExternalLiveProvider } from "../domain/live-event";
import type { LiveStartEvent } from "../domain/live-time-display";
import { LiveReservationLegend, LiveReservationMark } from "./live-reservation-mark";
import { LiveTimeIndicator } from "./live-time-indicator";
import { FanHeading } from "../../../components/fan-ui/fan-heading";
import styles from "./live-calendar-screen.module.css";

export type LiveCalendarCelebrityFilter = {
  slug: string;
  name: string;
  image: string;
  photos?: PhotoSet;
  imagePosition?: string;
};

export type LiveCalendarEventMetadata = {
  eventSlug: string;
  celebritySlug: string;
  platforms: readonly ExternalLiveProvider[];
};

const copy = {
  ko: {
    title: "LIVE 캘린더",
    intro: "날짜별 LIVE 일정을 한눈에 확인하고 원하는 방송으로 이동해 보세요.",
    previous: "이전 달",
    next: "다음 달",
    catalog: "전체 LIVE",
    weekdays: ["일", "월", "화", "수", "목", "금", "토"],
    status: { scheduled: "예정", live: "LIVE 중", ended: "종료", cancelled: "취소" },
    empty: "예정된 LIVE가 없어요.",
    filteredEmpty: "선택한 셀럽의 이번 달 LIVE가 없어요.",
    filterTitle: "셀럽 일정 필터",
    filterHelp: "여러 셀럽을 함께 선택할 수 있어요.",
    allCelebrities: "전체 셀럽 일정",
    allSelected: "전체 보기",
    selectedCount: (count: number) => `${count}명 선택`,
    selectedResult: (date: string, count: number) => `${date} · LIVE ${count}개`,
    selectedEmpty: "선택한 날짜에 예정된 LIVE가 없어요.",
    platformLabel: "송출 플랫폼",
  },
  en: {
    title: "LIVE calendar",
    intro: "Explore every LIVE by date and open the broadcast that matters to you.",
    previous: "Previous month",
    next: "Next month",
    catalog: "All LIVE",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    status: { scheduled: "Scheduled", live: "LIVE now", ended: "Ended", cancelled: "Cancelled" },
    empty: "No LIVE events scheduled.",
    filteredEmpty: "No LIVE is scheduled for the selected celebrities this month.",
    filterTitle: "Celebrity filters",
    filterHelp: "Select more than one celebrity to combine schedules.",
    allCelebrities: "All celebrity schedules",
    allSelected: "Showing all",
    selectedCount: (count: number) => `${count} selected`,
    selectedResult: (date: string, count: number) => `${date} · ${count} LIVE ${count === 1 ? "event" : "events"}`,
    selectedEmpty: "No LIVE events are scheduled for the selected date.",
    platformLabel: "Broadcast platforms",
  },
} as const;

const platformLabel: Record<ExternalLiveProvider, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const calendarTitlesKo = new Map([
  ["ifew-100-days-tiktok-20260912", "이퓨 틱톡100일 기념"],
  ["elina-banksy-instagram-20260918", "엘리나 x 뱅크시 전시회 LIVE"],
]);

function calendarHref(month: string, locale: FanLocale, celebritySlugs: readonly string[]) {
  const params = new URLSearchParams({ month, locale });
  for (const slug of celebritySlugs) params.append("celebrity", slug);
  return `/live/calendar?${params.toString()}` as Route;
}

const formatters = {
  ko: {
    month: new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", timeZone: "Asia/Seoul" }),
    day: new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }),
    time: new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }),
  },
  en: {
    month: new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", timeZone: "Asia/Seoul" }),
    day: new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Seoul" }),
  },
} as const;

function adjacentMonth(month: string, offset: -1 | 1) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string, locale: FanLocale) {
  const [year, monthNumber] = month.split("-").map(Number);
  return formatters[locale].month.format(new Date(Date.UTC(year!, monthNumber! - 1, 15)));
}

function dayLabel(date: string, locale: FanLocale) {
  const [year, month, day] = date.split("-").map(Number);
  return formatters[locale].day.format(new Date(Date.UTC(year!, month! - 1, day!, 3)));
}

function eventTime(startsAt: string, locale: FanLocale) {
  return formatters[locale].time.format(new Date(startsAt));
}

function calendarWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function LiveCalendarScreen({
  initialCalendar,
  locale,
  celebrities,
  eventMetadata,
  initialCelebritySlugs,
}: {
  initialCalendar: LiveCalendarMonth;
  locale: FanLocale;
  celebrities: readonly LiveCalendarCelebrityFilter[];
  eventMetadata: readonly LiveCalendarEventMetadata[];
  initialCelebritySlugs: readonly string[];
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [calendar, setCalendar] = useState(initialCalendar);
  const [selectedCelebritySlugs, setSelectedCelebritySlugs] = useState<string[]>([
    ...initialCelebritySlugs,
  ]);
  const [eventPositions, setEventPositions] = useState<Record<string, number>>({});
  const [modalDate, setModalDate] = useState<string | null>(null);
  const gesture = useRef<{ date: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const refreshedStarts = useRef(new Set<string>());
  const refreshController = useRef<AbortController | null>(null);
  const mobileResultHeading = useRef<HTMLHeadingElement | null>(null);
  const pendingMobileSelection = useRef<{ date: string; focus: boolean } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const isMobileCalendar = useMediaQuery("(max-width: 63.99rem)");
  const activeDate = selectedDate?.startsWith(`${calendar.month}-`) ? selectedDate : null;
  const t = copy[locale];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const previous = adjacentMonth(calendar.month, -1);
  const next = adjacentMonth(calendar.month, 1);
  const firstWeekday = calendarWeekday(
    calendar.days[0]?.date ?? `${calendar.month}-01`,
  );
  const trailingCellCount = (7 - ((firstWeekday + calendar.days.length) % 7)) % 7;
  const metadataByEventSlug = useMemo(
    () => new Map(eventMetadata.map((metadata) => [metadata.eventSlug, metadata])),
    [eventMetadata],
  );
  const selectedCelebritySet = useMemo(
    () => new Set(selectedCelebritySlugs),
    [selectedCelebritySlugs],
  );
  const visibleDays = useMemo(() => calendar.days.map((day) => ({
    ...day,
    events: selectedCelebritySet.size === 0
      ? day.events
      : day.events.filter((event) => {
          const metadata = metadataByEventSlug.get(event.slug);
          if (metadata) return selectedCelebritySet.has(metadata.celebritySlug);
          return celebrities.some(
            (celebrity) => selectedCelebritySet.has(celebrity.slug)
              && celebrity.name === event.celebrity.name,
          );
        }),
  })), [calendar.days, celebrities, metadataByEventSlug, selectedCelebritySet]);
  const visibleEventCount = visibleDays.reduce((total, day) => total + day.events.length, 0);
  const activeDay = activeDate ? visibleDays.find((day) => day.date === activeDate) : undefined;
  const activeEventCount = activeDay?.events.length ?? 0;

  useEffect(() => {
    setCalendar(initialCalendar);
    setEventPositions({});
    setModalDate(null);
  }, [initialCalendar]);

  useEffect(() => {
    setSelectedCelebritySlugs([...initialCelebritySlugs]);
    setEventPositions({});
    setModalDate(null);
  }, [initialCelebritySlugs]);

  useEffect(() => {
    const pending = pendingMobileSelection.current;
    if (!activeDate || pending?.date !== activeDate) return;
    pendingMobileSelection.current = null;
    const frame = window.requestAnimationFrame(() => {
      const heading = mobileResultHeading.current;
      if (!heading) return;
      heading.scrollIntoView?.({
        block: "start",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      if (pending.focus) heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDate]);

  const abortCalendarRefresh = useCallback(() => {
    refreshController.current?.abort();
    refreshController.current = null;
  }, []);

  const refreshCalendar = useCallback(async () => {
    if (!ready) return;
    abortCalendarRefresh();
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const token = authenticated ? await getAccessToken() : null;
      if (controller.signal.aborted) return;
      if (authenticated && !token) return;
      const response = await fetch(
        `/api/live-events/calendar?month=${initialCalendar.month}&locale=${locale}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        },
      );
      if (!response.ok) return;
      const nextCalendar = liveCalendarMonthSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setCalendar(nextCalendar);
    } catch {
      // Keep the current calendar visible if identity restoration or refresh fails.
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
    }
  }, [abortCalendarRefresh, authenticated, getAccessToken, initialCalendar.month, locale, ready]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      abortCalendarRefresh();
      setCalendar(initialCalendar);
      return;
    }
    void refreshCalendar();
    return abortCalendarRefresh;
  }, [abortCalendarRefresh, authenticated, initialCalendar, ready, refreshCalendar]);

  const handleStartReached = useCallback((event: LiveStartEvent) => {
    const key = `${event.id ?? "event"}:${event.startsAt}`;
    if (refreshedStarts.current.has(key)) return;
    refreshedStarts.current.add(key);
    void refreshCalendar();
  }, [refreshCalendar]);

  function selectCelebrities(next: readonly string[]) {
    const ordered = celebrities
      .map((celebrity) => celebrity.slug)
      .filter((slug) => next.includes(slug));
    setSelectedCelebritySlugs(ordered);
    setSelectedDate(null);
    setEventPositions({});
    setModalDate(null);
    const href = calendarHref(calendar.month, locale, ordered);
    window.history.replaceState(window.history.state, "", href);
  }

  function toggleCelebrity(slug: string) {
    selectCelebrities(selectedCelebritySet.has(slug)
      ? selectedCelebritySlugs.filter((selected) => selected !== slug)
      : [...selectedCelebritySlugs, slug]);
  }

  function selectMobileDate(date: string, focusResult: boolean) {
    const nextDate = activeDate === date ? null : date;
    pendingMobileSelection.current = nextDate ? { date: nextDate, focus: focusResult } : null;
    setSelectedDate(nextDate);
  }

  const modalDay = visibleDays.find(day => day.date === modalDate);
  const hasVisibleReservation = visibleDays.some((day) => day.events.some((event) => event.reservationState === "reserved"));
  function renderEvent(
    event: LiveCalendarMonth["days"][number]["events"][number],
    { isCurrent = true, showRelativeTime = false }: { isCurrent?: boolean; showRelativeTime?: boolean } = {},
  ) {
    const title = locale === "ko" ? calendarTitlesKo.get(event.slug) ?? event.title : event.title;
    const metadata = metadataByEventSlug.get(event.slug);
    const creatorSlug = metadata?.celebritySlug ?? "";
    const creatorPhotos = celebrities.find((creator) => creator.slug === creatorSlug);
    const platforms = metadata?.platforms ?? [];
    const platformNames = platforms.map((platform) => platformLabel[platform]);
    const tone = [...event.slug].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
    return <article className={styles.event} key={event.id} aria-label={title} data-current={isCurrent ? "true" : "false"} data-calendar-event-status={event.effectiveStatus} data-calendar-event-tone={tone}>
      <Link
        className={styles.eventLink}
        href={`/live/${event.slug}?locale=${locale}` as Route}
        aria-label={locale === "ko" ? `${title} 상세 보기` : `View ${title} details`}
      >
        <CreatorImage className={styles.eventPortrait} slug={creatorSlug} src={event.celebrity.image} photos={creatorPhotos?.photos ?? event.celebrity.photos} position={creatorPhotos?.imagePosition ?? event.celebrity.imagePosition} alt="" width={72} height={96} sizes="72px" presentation="vertical" framed />
        <span className={styles.eventMeta}>
          <time dateTime={event.startsAt}>{eventTime(event.startsAt, locale)}</time>
        </span>
        <strong className={styles.eventTitle}><span>{title}</span>{event.reservationState === "reserved" ? <LiveReservationMark locale={locale} className={styles.reservationMark} /> : null}</strong>
        <span className={styles.eventTopline}>
          <CreatorAvatar slug={creatorSlug} src={event.celebrity.image} photos={creatorPhotos?.photos ?? event.celebrity.photos} position={creatorPhotos?.imagePosition ?? event.celebrity.imagePosition} size={24} />
          <span className={styles.creator}>{event.celebrity.name}</span>
          {platforms.length > 0 ? <span
            className={styles.platforms}
            aria-label={`${t.platformLabel}: ${platformNames.join(", ")}`}
          >
            {platforms.map((platform) => <Image
              src={`/images/guest-home/${platform}.svg`}
              alt=""
              width={14}
              height={14}
              key={platform}
            />)}
          </span> : null}
          {showRelativeTime
            ? <LiveTimeIndicator event={event} locale={locale} active onStartReached={handleStartReached} variant="text" className={styles.calendarTimeIndicator} />
            : event.effectiveStatus === "live" || event.effectiveStatus === "scheduled" ? <LiveStatusIndicator className={styles.calendarStatus} label={t.status[event.effectiveStatus]} status={event.effectiveStatus} locale={locale} density="compact" /> : <span className={styles.status} data-status={event.effectiveStatus}>{t.status[event.effectiveStatus]}</span>}
        </span>
        {event.hasBenefit === true ? <span className={styles.eventExtras}>
          {event.hasBenefit === true ? <span className={styles.benefit}>Benefit</span> : null}
        </span> : null}
      </Link>
    </article>;
  }

  return (
    <FanAppFrame locale={locale} mainId="live-calendar-main" currentPath="/live/calendar">
      <FanContentContainer as="main" className={styles.main} id="live-calendar-main" tabIndex={-1}>
        <div className={styles.editorialHeader}>
        <header className={styles.intro}>
          <div>
            <FanHeading as="h1">{t.title}</FanHeading>
            <p>{t.intro}</p>
          </div>
          <Link className={styles.catalogLink} href={`/live?locale=${locale}` as Route}>
            <FanMotionIcon name="calendar" size={18} />
            {t.catalog}
          </Link>
        </header>
        <CalendarArt month={calendar.month} celebrity={selectedCelebritySlugs.length === 1
          ? celebrities.find((celebrity) => celebrity.slug === selectedCelebritySlugs[0])
          : undefined} />
        </div>

        <section className={styles.filters} aria-labelledby="calendar-filter-heading">
          <div className={styles.filterHeading}>
            <div>
              <h2 id="calendar-filter-heading">{t.filterTitle}</h2>
              <p>{t.filterHelp}</p>
            </div>
          </div>
          <div className={styles.filterScroller} role="group" aria-label={t.filterTitle}>
            <button
              className={styles.filterChip}
              data-selected={selectedCelebritySlugs.length === 0 ? "true" : undefined}
              type="button"
              aria-pressed={selectedCelebritySlugs.length === 0}
              onClick={() => selectCelebrities([])}
            >
              {selectedCelebritySlugs.length === 0 ? <Check aria-hidden="true" /> : null}{t.allCelebrities}
            </button>
            {celebrities.map((celebrity) => {
              const selected = selectedCelebritySet.has(celebrity.slug);
              return <button
                className={styles.filterChip}
                data-selected={selected ? "true" : undefined}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleCelebrity(celebrity.slug)}
                key={celebrity.slug}
              >
                <CreatorAvatar slug={celebrity.slug} src={celebrity.image} photos={celebrity.photos} position={celebrity.imagePosition} size={24} />
                {celebrity.name}{selectedCelebritySet.has(celebrity.slug) ? <Check aria-hidden="true" /> : null}
              </button>;
            })}
          </div>
          <span className={styles.filterCount} aria-live="polite">
            {selectedCelebritySlugs.length > 0
              ? t.selectedCount(selectedCelebritySlugs.length)
              : t.allSelected}
          </span>
        </section>

        <section className={styles.calendar} aria-labelledby="calendar-month-heading">
          <CalendarMonthHeader
            month={calendar.month} label={monthLabel(calendar.month, locale)} headingId="calendar-month-heading"
            previous={{ href: calendarHref(previous, locale, selectedCelebritySlugs), label: `${t.previous}: ${monthLabel(previous, locale)}` }}
            next={{ href: calendarHref(next, locale, selectedCelebritySlugs), label: `${t.next}: ${monthLabel(next, locale)}` }}
          />

          <div className={styles.mobileCalendar} data-mobile-calendar>
            <div className={styles.mobileWeekdays} aria-hidden="true">
              {t.weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
            </div>
            <div className={styles.mobileMonth} role="group" aria-label={monthLabel(calendar.month, locale)}>
              {Array.from({ length: firstWeekday }, (_, index) => <span aria-hidden="true" key={`mobile-leading-${index}`} />)}
              {visibleDays.map((day) => <button
                type="button"
                className={styles.mobileDay}
                key={day.date}
                data-calendar-date={day.date}
                data-upcoming-day={day.events.some((event) => event.effectiveStatus === "scheduled" || event.effectiveStatus === "live") ? "true" : undefined}
                aria-label={`${dayLabel(day.date, locale)}, ${day.events.length} LIVE`}
                aria-pressed={activeDate === day.date}
                aria-controls="calendar-day-list"
                onClick={(event) => selectMobileDate(day.date, event.detail === 0)}
              >
                <CalendarDayNumber date={day.date} today={today} />
                <span className={styles.mobileDayEvents} aria-hidden="true">
                  {Array.from({ length: Math.min(3, day.events.length) }, (_, index) => <i key={index} />)}
                </span>
              </button>)}
            </div>
            <div className={styles.mobileSelection}>
              <h3
                className={styles.mobileResultHeading}
                id="calendar-results-heading"
                ref={mobileResultHeading}
                tabIndex={-1}
                aria-live="polite"
                aria-atomic="true"
              >
                {activeDate
                  ? t.selectedResult(dayLabel(activeDate, locale), activeEventCount)
                  : `${visibleEventCount} LIVE`}
              </h3>
              {activeDate ? <button type="button" onClick={() => setSelectedDate(null)}>{locale === "ko" ? t.allSelected : "Show all"}</button> : null}
            </div>
            {activeDate && activeEventCount === 0
              ? <p className={styles.calendarEmpty}>{t.selectedEmpty}</p> : null}
          </div>


          <div className={styles.weekdays} aria-hidden="true">
            {t.weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>

          <div className={styles.days} id="calendar-day-list"
            data-mobile-empty={!visibleDays.some((day) => day.events.length > 0 && (!activeDate || day.date === activeDate)) ? "true" : undefined}
            data-mobile-selected={activeDate ? "true" : undefined}
          >
            {Array.from({ length: firstWeekday }, (_, index) => <span
              className={styles.outsideDay}
              data-outside-month="true"
              aria-hidden="true"
              key={`leading-${index}`}
            />)}
            {visibleDays.map((day, dayIndex) => {
              const label = dayLabel(day.date, locale);
              const isFirstColumn = (firstWeekday + dayIndex) % 7 === 0;
              const position = Math.min(eventPositions[day.date] ?? 0, Math.max(0, day.events.length - 1));
              const move = (offset: number) => setEventPositions(current => ({ ...current, [day.date]: Math.max(0, Math.min(day.events.length - 1, position + offset)) }));
              const eventListId = `calendar-events-${day.date}`;
              return <section
                className={styles.day}
                data-empty={day.events.length === 0 ? "true" : undefined}
                data-upcoming-day={day.events.some((event) => event.effectiveStatus === "scheduled" || event.effectiveStatus === "live") ? "true" : undefined}
                data-first-column={isFirstColumn ? "true" : undefined}
                data-mobile-hidden={activeDate && activeDate !== day.date ? "true" : undefined}
                key={day.date}
                role="group"
                aria-label={label}
              >
                <header className={styles.dayHeading}>
                  <CalendarDayNumber date={day.date} today={today} />
                  <span>{label}</span>
                  {day.events.length > 1 ? <>
                    <span className={styles.eventPosition} aria-live="polite" aria-atomic="true">{position + 1} / {day.events.length}</span>
                    <button className={styles.viewAll} type="button" aria-haspopup="dialog" onClick={() => setModalDate(day.date)}>{locale === "ko" ? "전체 보기" : "View all"}</button>
                  </> : null}
                </header>
                {day.events.length ? (
                  <div className={styles.eventStage} data-multiple={day.events.length > 1 ? "true" : undefined}>
                    <div className={styles.eventList} id={eventListId}
                      onDragStart={event => event.preventDefault()}
                      onPointerDown={event => {
                        suppressClick.current = false;
                        if (event.button !== 0 || !window.matchMedia("(min-width: 64rem)").matches) return;
                        gesture.current = { date: day.date, x: event.clientX, y: event.clientY };
                      }}
                      onPointerMove={event => {
                        const start = gesture.current;
                        if (!start || start.date !== day.date) return;
                        if (Math.abs(event.clientX - start.x) > 12 && Math.abs(event.clientX - start.x) > Math.abs(event.clientY - start.y)) {
                          suppressClick.current = true;
                          event.currentTarget.setPointerCapture?.(event.pointerId);
                        }
                      }}
                      onPointerUp={event => {
                        const start = gesture.current;
                        gesture.current = null;
                        if (!start || start.date !== day.date) return;
                        const dx = event.clientX - start.x;
                        if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
                          suppressClick.current = true;
                          move(dx < 0 ? 1 : -1);
                        }
                      }}
                      onPointerCancel={() => { gesture.current = null; suppressClick.current = false; }}
                      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
                    >
                    {day.events.map((event, index) => renderEvent(event, {
                      isCurrent: index === position,
                      showRelativeTime: isMobileCalendar && activeDate === day.date,
                    }))}
                    </div>
                    {day.events.length > 1 ? <div className={styles.dayControls}>
                      <div className={styles.carouselControls}>
                        <button type="button" aria-label={locale === "ko" ? "이전 LIVE" : "Previous LIVE"} aria-controls={eventListId} disabled={position === 0} onClick={() => move(-1)}><ChevronLeft aria-hidden="true" size={16} /></button>
                        <button type="button" aria-label={locale === "ko" ? "다음 LIVE" : "Next LIVE"} aria-controls={eventListId} disabled={position === day.events.length - 1} onClick={() => move(1)}><ChevronRight aria-hidden="true" size={16} /></button>
                      </div>
                    </div> : null}
                  </div>
                ) : <p className={styles.empty}>{t.empty}</p>}
              </section>;
            })}
            {Array.from({ length: trailingCellCount }, (_, index) => <span
              className={styles.outsideDay}
              data-outside-month="true"
              aria-hidden="true"
              key={`trailing-${index}`}
            />)}
          </div>
          {hasVisibleReservation ? <LiveReservationLegend locale={locale} className={styles.calendarLegend} /> : null}
        </section>
      </FanContentContainer>
      <Dialog open={Boolean(modalDay)} onClose={() => setModalDate(null)} labelledBy="calendar-dialog-title" backdropClassName={styles.modalBackdrop} contentClassName={styles.modal}>
        <header className={styles.modalHeader}>
          <h2 id="calendar-dialog-title">{modalDay ? dayLabel(modalDay.date, locale) : ""}</h2>
          <button type="button" onClick={() => setModalDate(null)} aria-label={locale === "ko" ? "닫기" : "Close"}><X aria-hidden="true" size={20} /></button>
        </header>
        <div className={styles.modalEvents}>{modalDay?.events.map(event => renderEvent(event, { showRelativeTime: true }))}</div>
      </Dialog>
    </FanAppFrame>
  );
}
