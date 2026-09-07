"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { Check } from "lucide-react";
import { ArrowRight } from "@/components/icons";
import { FanMotionIcon } from "@/components/fan-ui/fan-motion-icon";
import { LiveStatusIndicator } from "@/components/live-status-indicator";
import { CalendarDayNumber, CalendarMonthHeader } from "@/components/fan-calendar/calendar-parts";
import { liveCalendarMonthSchema, type LiveCalendarDay } from "@/features/live/domain/live-calendar";
import type { PublishedCelebrity, PublishedCelebrityLive, ContentLocale } from "@/server/content/content-domain";
import styles from "./calendar.module.css";
type AsyncState<T> = { status: "idle" | "loading" } | { status: "ready"; data:T } | {status:"error"};
const copy = {
ko: { calendarTitle:"LIVE 일정", calendarOpen:"캘린더 크게 보기", calendarLoading:"LIVE 일정을 확인하고 있어요", calendarError:"일정을 불러오지 못했어요.", calendarUpcoming:"다가오는 일정", calendarUpcomingEmpty:"이번 달에는 예정된 LIVE가 없어요.", previousMonth:"이전 달", nextMonth:"다음 달", reserved:"예약 완료", notReserved:"예약 전", reservationUnknown:"예약 확인 전", weekdays:["일","월","화","수","목","금","토"] },
en: { calendarTitle:"LIVE schedule", calendarOpen:"Open full calendar", calendarLoading:"Checking LIVE schedule", calendarError:"We couldn't load the schedule.", calendarUpcoming:"Upcoming", calendarUpcomingEmpty:"No upcoming LIVE this month.", previousMonth:"Previous month", nextMonth:"Next month", reserved:"Reserved", notReserved:"Not reserved", reservationUnknown:"Reservation unknown", weekdays:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] }
} as const;
function formatMiniCalendarDate(value: string, locale: ContentLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function localizedLiveStatus(status: string, locale: ContentLocale) {
  if (status === "live" || status === "scheduled") return <LiveStatusIndicator status={status} locale={locale} density="compact" />;
  return locale === "en" ? "Ended" : "종료";
}

function currentKstDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul",
  }).format(now);
}

function kstMonthForInstant(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function miniCalendarMonthLabel(month: string, locale: ContentLocale) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric", month: "long", timeZone: "Asia/Seoul",
  }).format(new Date(Date.UTC(year!, monthNumber! - 1, 15)));
}

function adjacentCalendarMonth(month: string, offset: -1 | 1) {
  const [year, monthNumber] = month.split("-").map(Number);
  const adjacent = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
  return `${adjacent.getUTCFullYear()}-${String(adjacent.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function emptyCalendarDays(month: string): LiveCalendarDay[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return Array.from({ length: dayCount }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    events: [],
  }));
}
export function CelebrityMiniCalendar({
  celebrity,
  locale,
  upcomingLive,
}: {
  celebrity: PublishedCelebrity;
  locale: ContentLocale;
  upcomingLive: PublishedCelebrityLive | null;
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const t = copy[locale];
  const today = currentKstDate();
  const currentMonth = today.slice(0, 7);
  const upcomingMonth = upcomingLive ? kstMonthForInstant(upcomingLive.startsAt) : null;
  const initialMonth = upcomingMonth && upcomingMonth >= currentMonth ? upcomingMonth : currentMonth;
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [state, setState] = useState<AsyncState<LiveCalendarDay[]>>({ status: "loading" });

  useEffect(() => {
    setMonth(initialMonth);
  }, [initialMonth]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    setSelectedDate(null);
    void (async () => {
      try {
        const token = authenticated ? await getAccessToken() : null;
        const response = await fetch(`/api/live-events/calendar?month=${month}&locale=${locale}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Calendar request failed");
        const calendar = liveCalendarMonthSchema.parse(await response.json());
        setState({
          status: "ready",
          data: calendar.days.map((day) => ({
            ...day,
            events: day.events.filter((event) => event.celebrity.name === celebrity.name),
          })),
        });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [authenticated, celebrity.name, getAccessToken, locale, month, ready]);

  const days = state.status === "ready" ? state.data : emptyCalendarDays(month);
  const firstWeekday = calendarWeekday(days[0]?.date ?? `${month}-01`);
  const previousMonth = adjacentCalendarMonth(month, -1);
  const nextMonth = adjacentCalendarMonth(month, 1);
  const upcomingEvents = days
    .flatMap((day) => day.events)
    .filter((event) => event.effectiveStatus === "live" || (event.effectiveStatus === "scheduled" && currentKstDate(new Date(event.startsAt)) >= today))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .slice(0, 3);

  const selectedDay = days.find((day) => day.date === selectedDate && day.events.length > 0);
  const displayedEvents = selectedDay
    ? [...selectedDay.events].sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    : upcomingEvents;
  const calendarListId = `${celebrity.slug}-calendar-events`;

  return (
    <section className={styles.heroCalendar} aria-labelledby={`${celebrity.slug}-mini-calendar-title`} aria-busy={state.status === "loading"}>
      <div className={styles.calendarHeading}>
        <h2 id={`${celebrity.slug}-mini-calendar-title`}><FanMotionIcon name="calendar" size={18} />{celebrity.name} {t.calendarTitle}</h2>
      </div>
      <CalendarMonthHeader month={month} label={miniCalendarMonthLabel(month, locale)} density="compact"
        previous={{ onClick: () => setMonth(previousMonth), label: `${t.previousMonth}: ${miniCalendarMonthLabel(previousMonth, locale)}` }}
        next={{ onClick: () => setMonth(nextMonth), label: `${t.nextMonth}: ${miniCalendarMonthLabel(nextMonth, locale)}` }}
      />
      <div className={styles.calendarWeekdays} aria-hidden="true">
        {t.weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className={styles.calendarDays}>
        {days.map((day, index) => {
          const dayNumber = Number(day.date.slice(-2));
          const firstEvent = day.events[0];
          const style = index === 0 ? { gridColumnStart: firstWeekday + 1 } : undefined;
          if (firstEvent) {
            const eventLabel = locale === "ko" ? `${dayNumber}일, ${day.events.length} LIVE` : `${dayNumber}, ${day.events.length} LIVE`;
            return (
              <button
                type="button"
                className={styles.calendarEventDay}
                data-upcoming={day.events.some(event => event.effectiveStatus === "scheduled" || event.effectiveStatus === "live") ? "true" : undefined}
                data-multiple={day.events.length > 1 ? "true" : undefined}
                data-today={day.date === today ? "true" : undefined}
                aria-pressed={selectedDay?.date === day.date}
                aria-controls={calendarListId}
                onClick={() => setSelectedDate(selectedDay?.date === day.date ? null : day.date)}
                key={day.date}
                style={style}
                aria-label={eventLabel}
              >
                <CalendarDayNumber date={day.date} today={today} />
                <span aria-hidden="true">{day.events.length > 1 ? day.events.length : ""}</span>
              </button>
            );
          }
          return (
            <span className={styles.calendarDay} data-today={day.date === today ? "true" : undefined} key={day.date} style={style}>
              <CalendarDayNumber date={day.date} today={today} />
            </span>
          );
        })}
      </div>
      {state.status !== "ready" ? <p className={styles.calendarMessage} role={state.status === "error" ? "alert" : "status"}>
        {state.status === "loading" ? t.calendarLoading : t.calendarError}
      </p> : null}
      <div className={styles.calendarUpcoming} id={calendarListId}>
        <div className={styles.calendarListHeading}>
          <h3 aria-live="polite">{selectedDay ? new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T00:00:00+09:00`)) : t.calendarUpcoming}</h3>
          {selectedDay ? <button type="button" onClick={() => setSelectedDate(null)}>{locale === "ko" ? "전체 보기" : "Show all"}</button> : null}
        </div>
        {state.status === "ready" && displayedEvents.length > 0 ? <ol>{displayedEvents.map((event) => (
          <li key={event.id} data-status={event.effectiveStatus}>
            <Link href={`/live/${event.slug}?locale=${locale}` as Route}>
              <time dateTime={event.startsAt}>{formatMiniCalendarDate(event.startsAt, locale)}</time>
              <strong>{event.title}</strong>
              <span>{localizedLiveStatus(event.effectiveStatus, locale)}</span>
              <small className={styles.calendarReservation}>{event.reservationState === "reserved" ? <Check aria-hidden="true" /> : null}{event.reservationState === "reserved" ? t.reserved : event.reservationState === "not_reserved" ? t.notReserved : t.reservationUnknown}</small>
            </Link>
          </li>
        ))}</ol> : state.status === "ready" ? <p>{t.calendarUpcomingEmpty}</p> : null}
      </div>
      <div className={styles.calendarFooter}>
        <Link href={`/live/calendar?month=${month}&locale=${locale}&celebrity=${celebrity.slug}` as Route}>{t.calendarOpen}<ArrowRight /></Link>
      </div>
    </section>
  );
}
