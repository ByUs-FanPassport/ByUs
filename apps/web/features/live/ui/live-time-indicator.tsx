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
  const { now } = useLiveStartClock(event, { active, onStartReached });
  return <span className={`${styles.indicator} ${className ?? ""}`} data-live-time={event.effectiveStatus} data-variant={variant} aria-live="off">
    {event.effectiveStatus === "live" ? <span className={styles.dot} aria-hidden="true" /> : null}
    {liveTimeLabel(event, now, locale)}
  </span>;
}
