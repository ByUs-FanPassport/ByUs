"use client";
import { useEffect, useState } from "react";
import type {
  AnalyticsPreset,
  AnalyticsWindow,
} from "../domain/admin-analytics";
import styles from "./analytics-dashboard.module.css";

export type AnalyticsWindowSelection = Pick<
  AnalyticsWindow,
  "from" | "to" | "asOf"
> & { preset: AnalyticsPreset };
function kstStart(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(
    Date.UTC(value("year"), value("month") - 1, value("day")) - 9 * 3600000,
  );
}
export function defaultAnalyticsWindow(
  now = new Date(),
): AnalyticsWindowSelection {
  const to = now,
    from = new Date(to.getTime() - 30 * 86400000);
  return {
    preset: "30d",
    from: from.toISOString(),
    to: to.toISOString(),
    asOf: to.toISOString(),
  };
}
export function analyticsWindowFromSearch(
  search: string,
  fallback = defaultAnalyticsWindow(),
): AnalyticsWindowSelection {
  const params = new URLSearchParams(search),
    from = params.get("from"),
    to = params.get("to"),
    asOf = params.get("asOf"),
    fromTime = from ? Date.parse(from) : Number.NaN,
    toTime = to ? Date.parse(to) : Number.NaN,
    asOfTime = asOf ? Date.parse(asOf) : Number.NaN;
  if (
    !from ||
    !to ||
    !asOf ||
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    !Number.isFinite(asOfTime) ||
    fromTime >= toTime ||
    toTime > asOfTime
  )
    return fallback;
  return {
    preset: "custom",
    from: new Date(fromTime).toISOString(),
    to: new Date(toTime).toISOString(),
    asOf: new Date(asOfTime).toISOString(),
  };
}
const local = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function AnalyticsWindowControl({
  value,
  onApply,
  locale = "ko",
}: {
  value: AnalyticsWindowSelection;
  onApply(value: AnalyticsWindowSelection): void;
  locale?: "ko" | "en";
}) {
  const [preset, setPreset] = useState(value.preset),
    [from, setFrom] = useState(local(value.from)),
    [to, setTo] = useState(local(value.to)),
    [error, setError] = useState(false);
  useEffect(() => {
    setPreset(value.preset);
    setFrom(local(value.from));
    setTo(local(value.to));
    setError(false);
  }, [value]);
  const labels =
    locale === "ko"
      ? {
          title: "조회 기간",
          today: "오늘",
          custom: "직접 설정",
          from: "시작",
          to: "종료",
          apply: "적용",
          error: "시작은 종료보다 이전이어야 합니다.",
        }
      : {
          title: "Period",
          today: "Today",
          custom: "Custom",
          from: "From",
          to: "To",
          apply: "Apply",
          error: "From must be before To.",
        };
  function choose(next: AnalyticsPreset) {
    setPreset(next);
    if (next === "custom") return;
    const now = new Date(),
      end = now,
      start =
        next === "today"
          ? kstStart(now)
          : new Date(now.getTime() - (next === "7d" ? 7 : 30) * 86400000);
    const selection = {
      preset: next,
      from: start.toISOString(),
      to: end.toISOString(),
      asOf: end.toISOString(),
    };
    setFrom(local(selection.from));
    setTo(local(selection.to));
    setError(false);
    onApply(selection);
  }
  function apply() {
    const f = new Date(from),
      t = new Date(to),
      asOf = new Date();
    if (!from || !to || f >= t || t > asOf) {
      setError(true);
      return;
    }
    setError(false);
    onApply({
      preset: "custom",
      from: f.toISOString(),
      to: t.toISOString(),
      asOf: asOf.toISOString(),
    });
  }
  return (
    <section
      className={styles.windowControl}
      aria-labelledby="analytics-window-heading"
    >
      <h2 id="analytics-window-heading">{labels.title}</h2>
      <div className={styles.presets} role="group" aria-label={labels.title}>
        {(["today", "7d", "30d", "custom"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={preset === item}
            onClick={() => choose(item)}
          >
            {item === "today"
              ? labels.today
              : item === "custom"
                ? labels.custom
                : item.toUpperCase()}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className={styles.customWindow}>
          <label>
            {labels.from}
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-invalid={error}
            />
          </label>
          <label>
            {labels.to}
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={error}
            />
          </label>
          <button type="button" onClick={apply}>
            {labels.apply}
          </button>
          {error && <p role="alert">{labels.error}</p>}
        </div>
      )}
    </section>
  );
}
