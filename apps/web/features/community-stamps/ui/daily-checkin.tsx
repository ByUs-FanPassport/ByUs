"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Check, RotateCcw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { notifyFanActivityUpdated } from "@/components/fan-ui/fan-activity-updates";
import {
  communityAwardResultSchema,
  communityStampKstDate,
} from "../domain/community-stamps";
import { communityStampAction, useCommunityStamps } from "./use-community-stamps";
import styles from "./daily-checkin.module.css";

type Locale = "ko" | "en";

const copy = {
  ko: {
    title: "오늘의 출석",
    help: "하루 한 번, 최애와 함께한 오늘을 스탬프로 남겨요.",
    loading: "출석 기록을 확인하고 있어요.",
    loadError: "출석 기록을 불러오지 못했어요.",
    retry: "다시 시도",
    login: "로그인하고 출석하기",
    action: "오늘 출석하기",
    pending: "출석 중…",
    earned: "오늘 출석 완료",
    awarded: "오늘의 출석 스탬프를 받았어요.",
    already: "오늘은 이미 출석했어요.",
    failed: "출석하지 못했어요. 다시 시도해 주세요.",
    wallet: "지갑을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
    auth: "로그인 정보를 다시 확인해 주세요.",
    count: (value: number) => `이번 달 ${value}일 출석`,
  },
  en: {
    title: "Today’s check-in",
    help: "Check in once a day and keep today with your favorite as a Stamp.",
    loading: "Checking your attendance.",
    loadError: "We couldn’t load your check-ins.",
    retry: "Try again",
    login: "Sign in to check in",
    action: "Check in today",
    pending: "Checking in…",
    earned: "Checked in today",
    awarded: "You earned today’s check-in Stamp.",
    already: "You’ve already checked in today.",
    failed: "We couldn’t check you in. Please try again.",
    wallet: "Your wallet is being prepared. Please try again shortly.",
    auth: "Please check your sign-in and try again.",
    count: (value: number) => `${value} check-in${value === 1 ? "" : "s"} this month`,
  },
} as const;

function actionError(error: unknown, locale: Locale) {
  const code = error instanceof Error ? error.message : "";
  if (code === "COMMUNITY_STAMP_WALLET_NOT_READY") return copy[locale].wallet;
  if (code === "AUTHENTICATION_REQUIRED") return copy[locale].auth;
  return copy[locale].failed;
}

function nextKstMidnight(today: string) {
  const [year, month, day] = today.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day! + 1) - 9 * 60 * 60 * 1000;
}

export function DailyCheckin({
  creator,
  locale,
  month,
  onCheckedDatesChange,
}: {
  creator: string;
  locale: Locale;
  month: string;
  onCheckedDatesChange: (dates: readonly string[]) => void;
}) {
  const auth = usePrivy();
  const ownerId = auth.user?.id;
  const t = copy[locale];

  useEffect(() => {
    onCheckedDatesChange([]);
  }, [auth.authenticated, auth.ready, creator, onCheckedDatesChange, ownerId]);

  if (!auth.ready) {
    return <section className={styles.panel} id="daily-checkin" aria-labelledby="daily-checkin-title"><div><h3 id="daily-checkin-title">{t.title}</h3><p role="status">{t.loading}</p></div></section>;
  }
  if (!auth.authenticated) {
    const returnTo = `/c/${creator}?locale=${locale}#daily-checkin`;
    return <section className={styles.panel} id="daily-checkin" aria-labelledby="daily-checkin-title"><div><h3 id="daily-checkin-title">{t.title}</h3><p>{t.help}</p></div><Link className={styles.primary} href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}` as Route}>{t.login}</Link></section>;
  }
  if (!ownerId) {
    return <section className={styles.panel} id="daily-checkin" aria-labelledby="daily-checkin-title"><div><h3 id="daily-checkin-title">{t.title}</h3><p role="status">{t.loading}</p></div></section>;
  }
  return <OwnerDailyCheckin key={`${ownerId}:${creator}`} creator={creator} locale={locale} month={month} ownerId={ownerId} onCheckedDatesChange={onCheckedDatesChange} />;
}

function OwnerDailyCheckin({
  creator,
  locale,
  month,
  ownerId,
  onCheckedDatesChange,
}: {
  creator: string;
  locale: Locale;
  month: string;
  ownerId: string;
  onCheckedDatesChange: (dates: readonly string[]) => void;
}) {
  const auth = usePrivy();
  const resource = useCommunityStamps(creator);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const t = copy[locale];
  const data = resource.state.status === "ready" ? resource.state.data : null;
  const checkedDates = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.stamps
      .filter((stamp) => stamp.kind === "daily_checkin" && stamp.celebritySlug === creator)
      .map((stamp) => communityStampKstDate(stamp.issuedAt)))].sort();
  }, [creator, data]);
  const checkedDatesKey = checkedDates.join(",");
  const checkedToday = data ? checkedDates.includes(data.today) : false;
  const monthCount = checkedDates.filter((date) => date.startsWith(`${month}-`)).length;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    onCheckedDatesChange(checkedDatesKey ? checkedDatesKey.split(",") : []);
  }, [checkedDatesKey, onCheckedDatesChange]);

  useEffect(() => {
    if (!data) return;
    const delay = Math.max(1_000, Math.min(nextKstMidnight(data.today) - Date.now() + 1_000, 2_147_483_647));
    const timer = window.setTimeout(resource.retry, delay);
    return () => window.clearTimeout(timer);
  }, [data?.today, resource.retry]);

  async function checkIn() {
    if (inFlight.current || checkedToday) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await communityStampAction(auth.getAccessToken, "check-in", { creator }, (value) => communityAwardResultSchema.parse(value));
      if (!alive.current) return;
      setMessage(result.awarded ? t.awarded : t.already);
      resource.retry();
      notifyFanActivityUpdated(ownerId, ["community"]);
    } catch (error) {
      if (!alive.current) return;
      setFailed(true);
      setMessage(actionError(error, locale));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <section className={styles.panel} id="daily-checkin" aria-labelledby="daily-checkin-title">
    <div className={styles.copy}>
      <h3 id="daily-checkin-title">{t.title}</h3>
      {resource.state.status === "loading"
        ? <p role="status">{t.loading}</p>
        : resource.state.status === "error"
          ? <p role="alert">{t.loadError} <button className={styles.retry} type="button" onClick={resource.retry}><RotateCcw aria-hidden="true" />{t.retry}</button></p>
          : <p>{checkedToday ? t.earned : t.help} <span className={styles.count}>{t.count(monthCount)}</span></p>}
    </div>
    {resource.state.status === "ready" ? <button className={styles.primary} type="button" disabled={busy || checkedToday} onClick={() => void checkIn()}>
      {checkedToday ? <Check aria-hidden="true" /> : null}{busy ? t.pending : checkedToday ? t.earned : t.action}
    </button> : null}
    {message ? <p className={`${styles.message} ${failed ? styles.error : ""}`} role={failed ? "alert" : "status"}>{message}</p> : null}
  </section>;
}
