"use client";

import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";

import { LiveStatusIndicator } from "@/components/live-status-indicator";

import { usePrivy } from "@privy-io/react-auth";
import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { CalendarDayNumber, CalendarMonthHeader } from "../../../components/fan-calendar/calendar-parts";
import { FanMotionIcon } from "../../../components/fan-ui/fan-motion-icon";
import type { LiveCalendarMonth } from "../domain/live-calendar";
import type { ExternalLiveProvider } from "../domain/live-event";
import { FanHeading } from "../../../components/fan-ui/fan-heading";
import styles from "./live-calendar-screen.module.css";

export type LiveCalendarCelebrityFilter = {
  slug: string;
  name: string;
  image: string;
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
    reservation: { reserved: "예약 완료", not_reserved: "미예약" },
    empty: "예정된 LIVE가 없어요.",
    filteredEmpty: "선택한 셀럽의 이번 달 LIVE가 없어요.",
    filterTitle: "셀럽 일정 필터",
    filterHelp: "여러 셀럽을 함께 선택할 수 있어요.",
    allCelebrities: "전체 셀럽 일정",
    allSelected: "전체 보기",
    selectedCount: (count: number) => `${count}명 선택`,
    platformLabel: "송출 플랫폼",
    moreEvents: (count: number) => `+${count}개 더보기`,
    collapseEvents: "접기",
  },
  en: {
    title: "LIVE calendar",
    intro: "Explore every LIVE by date and open the broadcast that matters to you.",
    previous: "Previous month",
    next: "Next month",
    catalog: "All LIVE",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    status: { scheduled: "Scheduled", live: "LIVE now", ended: "Ended", cancelled: "Cancelled" },
    reservation: { reserved: "Reserved", not_reserved: "Not reserved" },
    empty: "No LIVE events scheduled.",
    filteredEmpty: "No LIVE is scheduled for the selected celebrities this month.",
    filterTitle: "Celebrity filters",
    filterHelp: "Select more than one celebrity to combine schedules.",
    allCelebrities: "All celebrity schedules",
    allSelected: "Showing all",
    selectedCount: (count: number) => `${count} selected`,
    platformLabel: "Broadcast platforms",
    moreEvents: (count: number) => `+${count} more`,
    collapseEvents: "Show less",
  },
} as const;

const platformLabel: Record<ExternalLiveProvider, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

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
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
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

  useEffect(() => {
    setCalendar(initialCalendar);
  }, [initialCalendar]);

  useEffect(() => {
    setSelectedCelebritySlugs([...initialCelebritySlugs]);
  }, [initialCelebritySlugs]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setCalendar(initialCalendar);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch(
          `/api/live-events/calendar?month=${initialCalendar.month}&locale=${locale}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
        );
        if (!response.ok) return;
        setCalendar(await response.json() as LiveCalendarMonth);
      } catch {
        // Keep the public calendar visible if identity restoration or refresh fails.
      }
    })();
    return () => controller.abort();
  }, [authenticated, getAccessToken, initialCalendar, locale, ready]);

  function selectCelebrities(next: readonly string[]) {
    const ordered = celebrities
      .map((celebrity) => celebrity.slug)
      .filter((slug) => next.includes(slug));
    setSelectedCelebritySlugs(ordered);
    const href = calendarHref(calendar.month, locale, ordered);
    window.history.replaceState(window.history.state, "", href);
  }

  function toggleCelebrity(slug: string) {
    selectCelebrities(selectedCelebritySet.has(slug)
      ? selectedCelebritySlugs.filter((selected) => selected !== slug)
      : [...selectedCelebritySlugs, slug]);
  }

  return (
    <FanAppFrame locale={locale} mainId="live-calendar-main" currentPath="/live/calendar">
      <FanContentContainer as="main" className={styles.main} id="live-calendar-main" tabIndex={-1}>
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
                <CreatorAvatar slug={celebrity.slug} src={celebrity.image} size={24} />
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

          {visibleEventCount === 0 ? <p className={styles.calendarEmpty}>{t.filteredEmpty}</p> : null}

          <div className={styles.weekdays} aria-hidden="true">
            {t.weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>

          <div className={styles.days}>
            {Array.from({ length: firstWeekday }, (_, index) => <span
              className={styles.outsideDay}
              data-outside-month="true"
              aria-hidden="true"
              key={`leading-${index}`}
            />)}
            {visibleDays.map((day, dayIndex) => {
              const label = dayLabel(day.date, locale);
              const isFirstColumn = (firstWeekday + dayIndex) % 7 === 0;
              const expanded = expandedDates.has(day.date);
              const hiddenEventCount = Math.max(0, day.events.length - 2);
              const visibleEvents = expanded ? day.events : day.events.slice(0, 2);
              const eventListId = `calendar-events-${day.date}`;
              return <section
                className={styles.day}
                data-empty={day.events.length === 0 ? "true" : undefined}
                data-first-column={isFirstColumn ? "true" : undefined}
                key={day.date}
                role="group"
                aria-label={label}
              >
                <header className={styles.dayHeading}>
                  <CalendarDayNumber date={day.date} today={today} />
                  <span>{label}</span>
                </header>
                {day.events.length ? (
                  <>
                    <div className={styles.eventList} id={eventListId}>
                    {visibleEvents.map((event) => {
                      const platforms = metadataByEventSlug.get(event.slug)?.platforms ?? [];
                      const platformNames = platforms.map((platform) => platformLabel[platform]);
                      const tone = [...event.slug].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
                      return <article className={styles.event} key={event.id} aria-label={event.title} data-calendar-event-status={event.effectiveStatus} data-calendar-event-tone={tone}>
                        <Link
                          className={styles.eventLink}
                          href={`/live/${event.slug}?locale=${locale}` as Route}
                          aria-label={locale === "ko" ? `${event.title} 상세 보기` : `View ${event.title} details`}
                        >
                          <span className={styles.eventMeta}>
                            <time dateTime={event.startsAt}>{eventTime(event.startsAt, locale)}</time>
                            {event.reservationState ? <span>{t.reservation[event.reservationState]}</span> : null}
                            {event.hasBenefit === true ? <span className={styles.benefit}>Benefit</span> : null}
                          </span>
                          <strong>{event.title}</strong>
                          <span className={styles.eventTopline}>
                            <CreatorAvatar slug={metadataByEventSlug.get(event.slug)?.celebritySlug ?? ""} src={event.celebrity.image} size={24} />
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
                            {event.effectiveStatus === "live" || event.effectiveStatus === "scheduled" ? <LiveStatusIndicator label={t.status[event.effectiveStatus]} status={event.effectiveStatus} locale={locale} density="compact" /> : <span className={styles.status} data-status={event.effectiveStatus}>{t.status[event.effectiveStatus]}</span>}
                          </span>
                        </Link>
                      </article>;
                    })}
                    </div>
                    {hiddenEventCount > 0 ? <button
                      className={styles.eventDisclosure}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={eventListId}
                      onClick={() => setExpandedDates((current) => {
                        const nextDates = new Set(current);
                        if (expanded) nextDates.delete(day.date);
                        else nextDates.add(day.date);
                        return nextDates;
                      })}
                    >
                      {expanded ? t.collapseEvents : t.moreEvents(hiddenEventCount)}
                    </button> : null}
                  </>
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
        </section>
      </FanContentContainer>
    </FanAppFrame>
  );
}
