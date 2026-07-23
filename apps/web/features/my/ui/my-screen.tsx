"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Bell, BookOpen, CalendarDays, Gift, LogIn, RotateCcw, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";

import { AuthIntentLink } from "@/components/auth-intent-link";
import { FanAppFrame, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { mySummarySchema, type MySummary } from "../domain/my-summary";
import styles from "./my-screen.module.css";

const copy = {
  ko: {
    title: "MY",
    guestTitle: "팬 활동을 한곳에서 이어가세요.",
    guestBody: "로그인하면 내 Fan Passport, 예약한 LIVE, 받을 수 있는 혜택과 알림을 확인할 수 있어요.",
    login: "Google로 계속하기",
    loading: "내 팬 활동을 불러오고 있어요.",
    error: "MY 정보를 불러오지 못했어요.",
    retry: "다시 시도",
    greeting: "님의 팬 활동",
    passport: "내 Fan Passport",
    passportHelp: "최애와 함께한 순간과 Stamp를 확인하세요.",
    allPassport: "전체 Passport 보기",
    noPassport: "아직 발급된 Passport가 없어요.",
    findFavorite: "팬 인증할 최애 찾기",
    stamps: "Stamp",
    reservations: "예약한 LIVE",
    noReservation: "예정된 예약이 없어요.",
    findLive: "LIVE 둘러보기",
    benefits: "받을 수 있는 혜택",
    notifications: "읽지 않은 알림",
    settings: "설정",
  },
  en: {
    title: "MY",
    guestTitle: "Keep your fan activity together.",
    guestBody: "Sign in to see your Fan Passports, reserved LIVE events, available benefits, and alerts.",
    login: "Continue with Google",
    loading: "Loading your fan activity.",
    error: "We couldn’t load MY.",
    retry: "Try again",
    greeting: "Your fan activity",
    passport: "My Fan Passports",
    passportHelp: "See the moments and Stamps you collected with your favorites.",
    allPassport: "View all Passports",
    noPassport: "You don’t have a Passport yet.",
    findFavorite: "Find a favorite to verify",
    stamps: "Stamps",
    reservations: "Reserved LIVE",
    noReservation: "No upcoming reservations.",
    findLive: "Browse LIVE",
    benefits: "Available benefits",
    notifications: "Unread alerts",
    settings: "Settings",
  },
} as const;

export function MyScreen({ locale }: { locale: FanLocale }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; summary: MySummary } | { status: "error" }
  >({ status: "loading" });
  const [requestKey, setRequestKey] = useState(0);
  const t = copy[locale];
  const load = useCallback(async (signal: AbortSignal) => {
    const token = await getAccessToken();
    if (!token) { setState({ status: "error" }); return; }
    const response = await fetch(`/api/me/summary?locale=${locale}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error("summary failed");
    const body = await response.json() as { summary: unknown };
    setState({ status: "ready", summary: mySummarySchema.parse(body.summary) });
  }, [getAccessToken, locale]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setState({ status: "error" });
    });
    return () => controller.abort();
  }, [ready, authenticated, load, requestKey]);

  return (
    <FanAppFrame locale={locale}>
      <main className={styles.main}>
        <header className={styles.heading}><h1>{t.title}</h1></header>
        {!ready ? <p className={styles.state} role="status">{t.loading}</p>
          : !authenticated ? (
            <section className={styles.guest}>
              <BookOpen aria-hidden="true" /><h2>{t.guestTitle}</h2><p>{t.guestBody}</p>
              <AuthIntentLink locale={locale} input={{ sourcePath: "/my", sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}>
                <LogIn /><span>{t.login}</span><ArrowRight />
              </AuthIntentLink>
            </section>
          ) : state.status === "loading" ? <p className={styles.state} role="status">{t.loading}</p>
            : state.status === "error" ? (
              <section className={styles.state} role="alert"><p>{t.error}</p><button onClick={() => setRequestKey((value) => value + 1)}><RotateCcw />{t.retry}</button></section>
            ) : <Dashboard summary={state.summary} locale={locale} />}
      </main>
    </FanAppFrame>
  );
}

function Dashboard({ summary, locale }: { summary: MySummary; locale: FanLocale }) {
  const t = copy[locale];
  return (
    <div className={styles.dashboard}>
      <h2 className={styles.welcome}>{summary.profile.nickname ? `${summary.profile.nickname}${locale === "ko" ? t.greeting : ` · ${t.greeting}`}` : t.greeting}</h2>
      <section className={styles.passports}>
        <div className={styles.sectionHeading}><div><h2>{t.passport}</h2><p>{t.passportHelp}</p></div><Link href={`/passports?locale=${locale}` as Route}>{t.allPassport}<ArrowRight /></Link></div>
        {summary.passports.length ? <div className={styles.passportList}>{summary.passports.slice(0, 3).map((passport) => (
          <Link href={`/passports/${passport.id}?locale=${locale}` as Route} key={passport.id}>
            <Image src={passport.celebrity.image} alt="" width={64} height={64} />
            <div><strong>{passport.celebrity.name} Fan Passport</strong><span>{passport.stampCount} {t.stamps}</span></div><ArrowRight />
          </Link>
        ))}</div> : <div className={styles.empty}><span>{t.noPassport}</span><Link href={`/celebrities?locale=${locale}` as Route}>{t.findFavorite}<ArrowRight /></Link></div>}
      </section>
      <section className={styles.reservations}>
        <div className={styles.sectionHeading}><h2>{t.reservations}</h2></div>
        {summary.reservations.length ? <div className={styles.reservationList}>{summary.reservations.map((reservation) => (
          <Link href={`/live/${reservation.slug}?locale=${locale}` as Route} key={reservation.id}>
            <Image src={reservation.celebrity.image} alt="" width={56} height={56} />
            <div><strong>{reservation.title}</strong><span>{new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(reservation.startsAt))}</span></div>
            <CalendarDays />
          </Link>
        ))}</div> : <div className={styles.empty}><span>{t.noReservation}</span><Link href={`/live?locale=${locale}` as Route}>{t.findLive}<ArrowRight /></Link></div>}
      </section>
      <nav className={styles.utilities} aria-label={locale === "ko" ? "MY 바로가기" : "MY shortcuts"}>
        <Link href={`/benefits?locale=${locale}` as Route}><Gift /><span>{t.benefits}</span><strong>{summary.availableBenefitCount}</strong></Link>
        <Link href={`/notifications?locale=${locale}` as Route}><Bell /><span>{t.notifications}</span><strong>{summary.unreadNotificationCount}</strong></Link>
        <Link href={`/settings?locale=${locale}` as Route}><Settings /><span>{t.settings}</span><ArrowRight /></Link>
      </nav>
    </div>
  );
}
