"use client";

import { usePrivy } from "@privy-io/react-auth";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState, type CSSProperties } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import type { LiveCalendarMonth } from "../domain/live-calendar";
import styles from "./live-calendar-screen.module.css";

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
  },
} as const;

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
}: {
  initialCalendar: LiveCalendarMonth;
  locale: FanLocale;
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [calendar, setCalendar] = useState(initialCalendar);
  const t = copy[locale];
  const previous = adjacentMonth(calendar.month, -1);
  const next = adjacentMonth(calendar.month, 1);
  const firstWeekday = calendarWeekday(
    calendar.days[0]?.date ?? `${calendar.month}-01`,
  );

  useEffect(() => {
    setCalendar(initialCalendar);
  }, [initialCalendar]);

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

  return (
    <FanAppFrame locale={locale} mainId="live-calendar-main" currentPath="/live">
      <FanContentContainer as="main" className={styles.main} id="live-calendar-main" tabIndex={-1}>
        <header className={styles.intro}>
          <div>
            <h1>{t.title}</h1>
            <p>{t.intro}</p>
          </div>
          <Link className={styles.catalogLink} href={`/live?locale=${locale}` as Route}>
            <CalendarDays aria-hidden="true" />
            {t.catalog}
          </Link>
        </header>

        <section className={styles.calendar} aria-labelledby="calendar-month-heading">
          <div className={styles.monthNavigation}>
            <Link
              className={styles.monthControl}
              href={`/live/calendar?month=${previous}&locale=${locale}` as Route}
              aria-label={`${t.previous}: ${monthLabel(previous, locale)}`}
            >
              <ChevronLeft aria-hidden="true" />
              <span>{t.previous}</span>
            </Link>
            <h2 id="calendar-month-heading">{monthLabel(calendar.month, locale)}</h2>
            <Link
              className={styles.monthControl}
              href={`/live/calendar?month=${next}&locale=${locale}` as Route}
              aria-label={`${t.next}: ${monthLabel(next, locale)}`}
            >
              <span>{t.next}</span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>

          <div className={styles.weekdays} aria-hidden="true">
            {t.weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>

          <div className={styles.days} style={{ "--first-weekday": firstWeekday + 1 } as CSSProperties}>
            {calendar.days.map((day, dayIndex) => {
              const label = dayLabel(day.date, locale);
              const isFirstColumn = (firstWeekday + dayIndex) % 7 === 0;
              return <section
                className={styles.day}
                data-empty={day.events.length === 0 ? "true" : undefined}
                data-first-column={isFirstColumn ? "true" : undefined}
                key={day.date}
                role="group"
                aria-label={label}
              >
                <header className={styles.dayHeading}>
                  <time dateTime={day.date}>{Number(day.date.slice(-2))}</time>
                  <span>{label}</span>
                </header>
                {day.events.length ? (
                  <div className={styles.eventList}>
                    {day.events.map((event) => (
                      <article className={styles.event} key={event.id} aria-label={event.title}>
                        <Image
                          src={event.celebrity.image}
                          alt=""
                          width={40}
                          height={40}
                          unoptimized={event.celebrity.image.startsWith("https://")}
                        />
                        <Link
                          className={styles.eventLink}
                          href={`/live/${event.slug}?locale=${locale}` as Route}
                          aria-label={locale === "ko" ? `${event.title} 상세 보기` : `View ${event.title} details`}
                        >
                          <span className={styles.eventTopline}>
                            <span className={styles.creator}>{event.celebrity.name}</span>
                            <span className={styles.status} data-status={event.effectiveStatus}>
                              {t.status[event.effectiveStatus]}
                            </span>
                          </span>
                          <strong>{event.title}</strong>
                          <span className={styles.eventMeta}>
                            <time dateTime={event.startsAt}>{eventTime(event.startsAt, locale)}</time>
                            {event.reservationState ? <span>{t.reservation[event.reservationState]}</span> : null}
                            {event.hasBenefit === true ? <span className={styles.benefit}>Benefit</span> : null}
                          </span>
                        </Link>
                      </article>
                    ))}
                  </div>
                ) : <p className={styles.empty}>{t.empty}</p>}
              </section>;
            })}
          </div>
        </section>
      </FanContentContainer>
    </FanAppFrame>
  );
}
