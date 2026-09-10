"use client";

import { formatCompactLiveStart, type LiveStartEvent } from "@/features/live/domain/live-time-display";
import { useLiveStartClock } from "@/features/live/ui/use-live-start-clock";
import styles from "./my-live-countdown.module.css";

export type MyLiveCountdownEvent = LiveStartEvent & { id: string };

type MyLiveCountdownProps = {
  event: MyLiveCountdownEvent;
  locale: "ko" | "en";
  active?: boolean;
  pulseScheduled?: boolean;
  onStartReached?: (event: MyLiveCountdownEvent) => void;
};

export function formatMyLiveCountdown(startsAt: string, now: number, locale: "ko" | "en" = "ko") {
  return formatCompactLiveStart(startsAt, now, locale);
}

export function MyLiveCountdown({ event, locale, active = true, pulseScheduled = false, onStartReached }: MyLiveCountdownProps) {
  const clock = useLiveStartClock(event, { active, onStartReached });
  const isLive = event.effectiveStatus === "live";
  const isScheduled = event.effectiveStatus === "scheduled";
  const remaining = clock.now === null ? null : Date.parse(event.startsAt) - clock.now;
  const shouldPulse = active && clock.visible && (isLive || (remaining !== null && remaining > 0 && (pulseScheduled || remaining < 86_400_000)));

  if (!isScheduled && !isLive) return null;

  const value = clock.now === null
    ? locale === "ko" ? "LIVE 예정" : "Upcoming LIVE"
    : formatMyLiveCountdown(event.startsAt, clock.now, locale);

  return <span className={styles.countdown} data-active={active ? "true" : "false"} data-pulse={shouldPulse ? "true" : "false"} data-status={event.effectiveStatus} aria-live="off">
    <span className={styles.dot} aria-hidden="true" />
    {isLive ? <span className={styles.liveLabel}>{locale === "ko" ? "진행 중" : "Live now"}</span> : <span className={styles.value}>{value}</span>}
  </span>;
}
