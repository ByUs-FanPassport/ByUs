"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import styles from "./my-live-countdown.module.css";

export type MyLiveCountdownEvent = {
  id: string;
  startsAt: string;
  effectiveStatus: "scheduled" | "live" | "ended" | "cancelled";
};

type MyLiveCountdownProps = {
  event: MyLiveCountdownEvent;
  locale: "ko" | "en";
  active?: boolean;
  onStartReached?: (event: MyLiveCountdownEvent) => void;
};

const SECOND_MS = 1_000;
const DAY_SECONDS = 24 * 60 * 60;

type ClockSnapshot = Readonly<{ now: number | null; visible: boolean }>;
type ClockSubscription = { listener: () => void; tickUntil: number | null };

const SERVER_CLOCK_SNAPSHOT: ClockSnapshot = Object.freeze({ now: null, visible: false });

const sharedCountdownClock = (() => {
  let snapshot = SERVER_CLOCK_SNAPSHOT;
  let timer: number | undefined;
  const subscriptions = new Set<ClockSubscription>();

  const emit = () => subscriptions.forEach(({ listener }) => listener());
  const updateSnapshot = (next: ClockSnapshot) => {
    if (snapshot.now === next.now && snapshot.visible === next.visible) return;
    snapshot = next;
    emit();
  };
  const needsTimer = () => snapshot.visible
    && Array.from(subscriptions).some(({ tickUntil }) => tickUntil !== null && tickUntil > Date.now());
  const stopTimer = () => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
  };
  const reconcileTimer = () => {
    if (!needsTimer()) {
      stopTimer();
      return;
    }
    if (timer !== undefined) return;
    timer = window.setInterval(() => {
      updateSnapshot({ now: Date.now(), visible: true });
      reconcileTimer();
    }, SECOND_MS);
  };
  const syncVisibility = () => {
    const visible = document.visibilityState !== "hidden";
    updateSnapshot({ now: Date.now(), visible });
    reconcileTimer();
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_CLOCK_SNAPSHOT,
    subscribe(listener: () => void, tickUntil: number | null) {
      const subscription = { listener, tickUntil };
      const wasEmpty = subscriptions.size === 0;
      subscriptions.add(subscription);
      if (wasEmpty) document.addEventListener("visibilitychange", syncVisibility);
      syncVisibility();

      return () => {
        subscriptions.delete(subscription);
        reconcileTimer();
        if (subscriptions.size > 0) return;
        stopTimer();
        document.removeEventListener("visibilitychange", syncVisibility);
        snapshot = SERVER_CLOCK_SNAPSHOT;
      };
    },
  };
})();

function remainingSeconds(startsAt: string, now: number) {
  return Math.max(0, Math.floor((Date.parse(startsAt) - now) / SECOND_MS));
}

export function formatMyLiveCountdown(startsAt: string, now: number) {
  const remaining = remainingSeconds(startsAt, now);
  const days = Math.floor(remaining / DAY_SECONDS);
  const hours = Math.floor((remaining % DAY_SECONDS) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const seconds = remaining % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");

  return days > 0 ? `D-${days} ${clock}` : clock;
}

export function MyLiveCountdown({
  event,
  locale,
  active = true,
  onStartReached,
}: MyLiveCountdownProps) {
  const callbackRef = useRef(onStartReached);
  const eventRef = useRef(event);
  const notifiedStarts = useRef(new Set<string>());

  const eventKey = `${event.id}:${event.startsAt}`;
  const isLive = event.effectiveStatus === "live";
  const isScheduled = event.effectiveStatus === "scheduled";
  const tickUntil = isScheduled ? Date.parse(event.startsAt) : null;
  const subscribe = useCallback((listener: () => void) => {
    if (!active || (!isScheduled && !isLive)) return () => {};
    return sharedCountdownClock.subscribe(listener, tickUntil);
  }, [active, isLive, isScheduled, tickUntil]);
  const clock = useSyncExternalStore(
    subscribe,
    sharedCountdownClock.getSnapshot,
    sharedCountdownClock.getServerSnapshot,
  );

  useEffect(() => {
    callbackRef.current = onStartReached;
    eventRef.current = event;
  }, [event, onStartReached]);

  useEffect(() => {
    if (!active || !isScheduled || tickUntil === null || !clock.visible || clock.now === null) return;
    if (clock.now < tickUntil || notifiedStarts.current.has(eventKey)) return;
    notifiedStarts.current.add(eventKey);
    callbackRef.current?.(eventRef.current);
  }, [active, clock, eventKey, isScheduled, tickUntil]);

  const scheduledValue = clock.now === null
    ? "--:--:--"
    : formatMyLiveCountdown(event.startsAt, clock.now);
  const shouldPulse = active && clock.visible && (
    isLive || (clock.now !== null && remainingSeconds(event.startsAt, clock.now) < DAY_SECONDS)
  );

  if (!isScheduled && !isLive) return null;

  return (
    <span
      className={styles.countdown}
      data-active={active ? "true" : "false"}
      data-pulse={shouldPulse ? "true" : "false"}
      data-status={event.effectiveStatus}
      aria-live="off"
    >
      <span className={styles.dot} aria-hidden="true" />
      {isLive ? (
        <span className={styles.liveLabel}>{locale === "ko" ? "진행 중" : "Live now"}</span>
      ) : (
        <>
          <span className={styles.label}>{locale === "ko" ? "시작까지" : "Starts in"}</span>
          <span className={styles.value}>{scheduledValue}</span>
        </>
      )}
    </span>
  );
}
