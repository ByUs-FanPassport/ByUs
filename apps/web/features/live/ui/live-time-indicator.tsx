"use client";

import { liveTimeLabel, type LiveStartEvent, type LiveTimeLocale } from "../domain/live-time-display";
import { useLiveStartClock } from "./use-live-start-clock";
import styles from "./live-time-indicator.module.css";

export function LiveTimeIndicator({ event, locale, active = true, onStartReached, variant = "badge", className }: {
  event: LiveStartEvent;
  locale: LiveTimeLocale;
  active?: boolean;
  onStartReached?: (event: LiveStartEvent) => void;
  variant?: "badge" | "text";
  className?: string;
}) {
  const { now, visible } = useLiveStartClock(event, { active, onStartReached });
  const upcoming = event.effectiveStatus === "scheduled" && now !== null && Date.parse(event.startsAt) > now;
  const shouldPulse = active && visible && (upcoming || event.effectiveStatus === "live");
  return <span className={`${styles.indicator} ${styles.emphasis} ${className ?? ""}`} data-live-time={event.effectiveStatus} data-status={event.effectiveStatus} data-pulse={shouldPulse ? "true" : "false"} data-variant={variant} aria-live="off">
    {event.effectiveStatus === "scheduled" || event.effectiveStatus === "live" ? <span className={styles.dot} aria-hidden="true" /> : null}
    {liveTimeLabel(event, now, locale)}
  </span>;
}
