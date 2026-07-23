"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, CalendarDays, Play, Radio, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";

import { FanAppFrame, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import type { LiveEventResponse } from "../domain/live-event";
import styles from "./live-catalog-screen.module.css";

type Catalog = {
  liveNow: readonly LiveEventResponse[];
  upcoming: readonly LiveEventResponse[];
  replay: readonly LiveEventResponse[];
};

const copy = {
  ko: {
    title: "모든 LIVE",
    intro: "지금 함께하거나, 다음 만남을 예약하고, 지나간 순간을 다시 만나보세요.",
    liveNow: "지금 LIVE",
    liveNowSub: "지금 바로 입장할 수 있는 방송이에요.",
    upcoming: "다가오는 LIVE",
    upcomingSub: "일정을 확인하고 미리 예약해 보세요.",
    replay: "다시보기",
    replaySub: "종료된 LIVE의 공개 영상을 다시 만나요.",
    emptyAll: "현재 공개된 LIVE가 없습니다.",
    emptyLive: "현재 진행 중인 LIVE가 없어요.",
    emptyUpcoming: "예정된 LIVE가 없어요.",
    emptyReplay: "공개된 다시보기가 없어요.",
    enter: "라이브 입장하기",
    reserve: "라이브 예약하기",
    reserved: "예약 완료",
    watch: "다시보기",
    retry: "내 예약 상태 다시 불러오기",
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
    watch: "Watch replay",
    retry: "Reload my reservation status",
  },
} as const;

function dateRange(item: LiveEventResponse, locale: FanLocale) {
  const formatter = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
  return `${formatter.format(new Date(item.live.startsAt))} – ${formatter.format(new Date(item.live.endsAt))}`;
}

function action(item: LiveEventResponse, locale: FanLocale) {
  const t = copy[locale];
  if (item.live.effectiveStatus === "live") return { label: t.enter, icon: <Play />, external: true };
  if (item.live.effectiveStatus === "ended") return { label: t.watch, icon: <Play />, external: true };
  if (item.viewer.reservation) return { label: t.reserved, icon: <CalendarDays />, external: false };
  return { label: t.reserve, icon: <CalendarDays />, external: false };
}

function LiveGroup({
  id,
  title,
  subtitle,
  empty,
  items,
  locale,
}: {
  id: string;
  title: string;
  subtitle: string;
  empty: string;
  items: readonly LiveEventResponse[];
  locale: FanLocale;
}) {
  return (
    <section className={styles.group} aria-labelledby={`${id}-heading`}>
      <div className={styles.groupHeading}>
        <div><h2 id={`${id}-heading`}>{title}</h2><p>{subtitle}</p></div>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <div className={styles.list}>
          {items.map((item) => {
            const currentAction = action(item, locale);
            const href = currentAction.external
              ? item.live.watch.url
              : `/live/${item.live.slug}?locale=${locale}`;
            return (
              <article className={styles.row} key={item.live.id}>
                <Image src={item.live.celebrity.image} alt="" width={80} height={80} />
                <div className={styles.details}>
                  <span>{item.live.celebrity.name} · {item.live.brand.name}</span>
                  <h3><Link href={`/live/${item.live.slug}?locale=${locale}` as Route}>{item.live.title}</Link></h3>
                  <p>{dateRange(item, locale)}</p>
                </div>
                <Link
                  className={styles.action}
                  href={href as Route}
                  target={currentAction.external ? "_blank" : undefined}
                  rel={currentAction.external ? "noreferrer" : undefined}
                >
                  {currentAction.icon}<span>{currentAction.label}</span><ArrowRight />
                </Link>
              </article>
            );
          })}
        </div>
      ) : <p className={styles.empty}>{empty}</p>}
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
  const t = copy[locale];

  useEffect(() => {
    if (!ready || !authenticated) return;
    const controller = new AbortController();
    setFailed(false);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch(`/api/live-events?locale=${locale}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("catalog request failed");
        const body = await response.json() as { catalog: Catalog };
        setCatalog(body.catalog);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [ready, authenticated, getAccessToken, locale, requestKey]);

  const total = catalog.liveNow.length + catalog.upcoming.length + catalog.replay.length;
  return (
    <FanAppFrame locale={locale}>
      <main className={styles.main}>
        <header className={styles.intro}>
          <Radio aria-hidden="true" />
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </header>
        {failed ? <button className={styles.retry} onClick={() => setRequestKey((value) => value + 1)}><RotateCcw />{t.retry}</button> : null}
        {total === 0 ? <p className={styles.emptyAll}>{t.emptyAll}</p> : (
          <>
            <LiveGroup id="live-now" title={t.liveNow} subtitle={t.liveNowSub} empty={t.emptyLive} items={catalog.liveNow} locale={locale} />
            <LiveGroup id="upcoming" title={t.upcoming} subtitle={t.upcomingSub} empty={t.emptyUpcoming} items={catalog.upcoming} locale={locale} />
            <LiveGroup id="replay" title={t.replay} subtitle={t.replaySub} empty={t.emptyReplay} items={catalog.replay} locale={locale} />
          </>
        )}
      </main>
    </FanAppFrame>
  );
}
