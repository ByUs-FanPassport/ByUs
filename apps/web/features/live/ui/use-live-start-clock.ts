"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { LiveStartEvent } from "../domain/live-time-display";

type ClockPrecision = "minute" | "second";
type ClockSnapshot = Readonly<{ now: number | null; visible: boolean }>;
type ClockSubscription = { listener: () => void; precision: ClockPrecision; tickUntil: number | null };
const PRECISION_MS = { minute: 60_000, second: 1_000 } as const;
const SERVER_SNAPSHOT: ClockSnapshot = Object.freeze({ now: null, visible: false });
const notificationsByHandler = new WeakMap<object, Set<string>>();

// One scheduler serves all precisions. A compact subscriber receives only minute
// boundaries, visibility changes, and its start deadline, even beside a live clock.
const sharedStartClock = (() => {
  const snapshots: Record<ClockPrecision, ClockSnapshot> = { minute: SERVER_SNAPSHOT, second: SERVER_SNAPSHOT };
  const subscriptions = new Set<ClockSubscription>();
  let timer: number | undefined;
  let scheduledAt: number | undefined;

  function stopTimer() {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    scheduledAt = undefined;
  }

  function publish(now: number, visible: boolean, force = false) {
    const changed = new Set<ClockPrecision>();
    for (const precision of ["minute", "second"] as const) {
      const previous = snapshots[precision];
      const precisionChanged = previous.now === null
        || Math.floor(previous.now / PRECISION_MS[precision]) !== Math.floor(now / PRECISION_MS[precision]);
      const reachedStart = Array.from(subscriptions).some(subscription => subscription.precision === precision
        && subscription.tickUntil !== null && subscription.tickUntil > (previous.now ?? -Infinity) && subscription.tickUntil <= now);
      if (force || precisionChanged || reachedStart || previous.visible !== visible) {
        snapshots[precision] = { now, visible };
        changed.add(precision);
      }
    }
    subscriptions.forEach(({ listener, precision }) => { if (changed.has(precision)) listener(); });
  }

  function schedule() {
    const now = Date.now();
    let next = Infinity;
    if (snapshots.second.visible) {
      for (const { precision, tickUntil } of subscriptions) {
        if (tickUntil === null || tickUntil <= now) continue;
        const period = PRECISION_MS[precision];
        const boundary = (Math.floor(now / period) + 1) * period;
        next = Math.min(next, boundary, tickUntil);
      }
    }
    if (!Number.isFinite(next)) { stopTimer(); return; }
    if (timer !== undefined && scheduledAt === next) return;
    stopTimer();
    scheduledAt = next;
    timer = window.setTimeout(() => {
      timer = undefined;
      scheduledAt = undefined;
      publish(Date.now(), document.visibilityState !== "hidden");
      schedule();
    }, Math.max(1, next - now));
  }

  function syncVisibility() {
    publish(Date.now(), document.visibilityState !== "hidden", true);
    schedule();
  }

  return {
    getSnapshot: (precision: ClockPrecision) => snapshots[precision],
    subscribe(listener: () => void, precision: ClockPrecision, tickUntil: number | null) {
      const subscription = { listener, precision, tickUntil };
      const wasEmpty = subscriptions.size === 0;
      subscriptions.add(subscription);
      if (wasEmpty) document.addEventListener("visibilitychange", syncVisibility);
      syncVisibility();
      return () => {
        subscriptions.delete(subscription);
        schedule();
        if (subscriptions.size > 0) return;
        document.removeEventListener("visibilitychange", syncVisibility);
        snapshots.minute = SERVER_SNAPSHOT;
        snapshots.second = SERVER_SNAPSHOT;
      };
    },
  };
})();

export function useLiveStartClock<T extends LiveStartEvent>(event: T, {
  active = true,
  precision = "minute",
  onStartReached,
}: {
  active?: boolean;
  precision?: ClockPrecision;
  onStartReached?: (event: T) => void;
} = {}): ClockSnapshot {
  const callbackRef = useRef(onStartReached);
  const eventRef = useRef(event);
  const notifiedStarts = useRef(new Set<string>());
  const eventKey = `${event.id ?? ""}:${event.startsAt}`;
  const scheduled = event.effectiveStatus === "scheduled";
  const live = event.effectiveStatus === "live";
  const start = Date.parse(event.startsAt);
  const tickUntil = scheduled && Number.isFinite(start) ? start : null;
  const subscribe = useCallback((listener: () => void) => {
    if (!active || (!scheduled && !live)) return () => {};
    return sharedStartClock.subscribe(listener, precision, tickUntil);
  }, [active, live, precision, scheduled, tickUntil]);
  const getSnapshot = useCallback(() => sharedStartClock.getSnapshot(precision), [precision]);
  const clock = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  useEffect(() => {
    callbackRef.current = onStartReached;
    eventRef.current = event;
  }, [event, onStartReached]);

  useEffect(() => {
    if (!active || !scheduled || tickUntil === null || !clock.visible || clock.now === null) return;
    if (clock.now < tickUntil || notifiedStarts.current.has(eventKey)) return;
    const callback = callbackRef.current;
    if (!callback) return;
    notifiedStarts.current.add(eventKey);
    const delivered = notificationsByHandler.get(callback) ?? new Set<string>();
    if (delivered.has(eventKey)) return;
    delivered.add(eventKey);
    notificationsByHandler.set(callback, delivered);
    callback(eventRef.current);
  }, [active, clock, eventKey, scheduled, tickUntil]);

  return clock;
}
