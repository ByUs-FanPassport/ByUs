export type LiveTimeLocale = "ko" | "en";

export type LiveStartEvent = {
  id?: string;
  startsAt: string;
  effectiveStatus: "scheduled" | "live" | "ended" | "cancelled";
};

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const kstTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function kstDaysUntil(startsAt: string, now: number): number {
  const start = Date.parse(startsAt);
  return Math.max(0, Math.floor((start + KST_OFFSET_MS) / DAY_MS) - Math.floor((now + KST_OFFSET_MS) / DAY_MS));
}

export function formatCompactLiveStart(startsAt: string, now: number, locale: LiveTimeLocale): string {
  const remaining = Date.parse(startsAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return locale === "ko" ? "시작 확인 중" : "Checking start";
  if (remaining < MINUTE_MS) return locale === "ko" ? "곧 시작" : "Starting soon";
  if (remaining < HOUR_MS) {
    const minutes = Math.ceil(remaining / MINUTE_MS);
    return locale === "ko" ? `${minutes}분 후 시작` : `Starts in ${minutes} min`;
  }
  const days = kstDaysUntil(startsAt, now);
  if (days > 0) return `D-${days}`;
  const time = kstTime.format(new Date(startsAt));
  return locale === "ko" ? `오늘 ${time}` : `Today ${time}`;
}

export function formatDetailedLiveCountdown(startsAt: string, now: number, locale: LiveTimeLocale = "ko"): string {
  const remaining = Date.parse(startsAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return locale === "ko" ? "시작 확인 중" : "Checking start";
  const days = kstDaysUntil(startsAt, now);
  if (remaining >= DAY_MS) return `D-${days}`;
  const seconds = Math.ceil(remaining / SECOND_MS);
  const clock = [Math.floor(seconds / 3_600), Math.floor((seconds % 3_600) / 60), seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `D-${days} · ${clock}` : clock;
}

export function liveTimeLabel(event: LiveStartEvent, now: number | null, locale: LiveTimeLocale): string {
  switch (event.effectiveStatus) {
    case "live": return locale === "ko" ? "LIVE 진행중" : "LIVE NOW";
    case "ended": return locale === "ko" ? "종료" : "Ended";
    case "cancelled": return locale === "ko" ? "취소" : "Cancelled";
    case "scheduled":
      if (now === null) return locale === "ko" ? "LIVE 예정" : "Upcoming LIVE";
      return formatCompactLiveStart(event.startsAt, now, locale);
  }
}
