import { describe, expect, it } from "vitest";
import { formatCompactLiveStart, formatDetailedLiveCountdown, kstDaysUntil, liveTimeLabel } from "./live-time-display";

describe("KST LIVE start labels", () => {
  it("uses calendar dates for tomorrow even when less than 24 hours remain", () => {
    const start = "2027-01-01T01:00:00+09:00";
    const beforeMidnight = Date.parse("2026-12-31T23:00:00+09:00");
    expect(kstDaysUntil(start, beforeMidnight)).toBe(1);
    expect(formatCompactLiveStart(start, beforeMidnight, "ko")).toBe("D-1");
    expect(formatDetailedLiveCountdown(start, beforeMidnight)).toBe("D-1 · 02:00:00");
    expect(formatCompactLiveStart(start, Date.parse("2027-01-01T00:00:00+09:00"), "ko")).toBe("오늘 01:00");
  });

  it("keeps the same calendar-day count in compact and detailed distant events", () => {
    const start = "2026-09-12T08:00:00+09:00";
    const now = Date.parse("2026-09-10T23:00:00+09:00");
    expect(formatCompactLiveStart(start, now, "ko")).toBe("D-2");
    expect(formatDetailedLiveCountdown(start, now)).toBe("D-2");
  });

  it.each([
    [60 * 60_000, "오늘 20:00", "Today 20:00"],
    [45 * 60_000, "45분 후 시작", "Starts in 45 min"],
    [45 * 60_000 + 1, "46분 후 시작", "Starts in 46 min"],
    [60_000, "1분 후 시작", "Starts in 1 min"],
    [59_999, "곧 시작", "Starting soon"],
    [0, "시작 확인 중", "Checking start"],
    [-1, "시작 확인 중", "Checking start"],
  ])("handles %i ms remaining without advancing the server's state", (remaining, ko, en) => {
    const start = "2026-09-12T20:00:00+09:00";
    const now = Date.parse(start) - remaining;
    expect(formatCompactLiveStart(start, now, "ko")).toBe(ko);
    expect(formatCompactLiveStart(start, now, "en")).toBe(en);
  });

  it("does not show a zero clock or LIVE before the server confirms the start", () => {
    const start = "2026-09-12T20:00:00+09:00";
    expect(formatDetailedLiveCountdown(start, Date.parse(start) - 1)).toBe("00:00:01");
    expect(formatDetailedLiveCountdown(start, Date.parse(start))).toBe("시작 확인 중");
    expect(formatDetailedLiveCountdown(start, Date.parse(start) + 1_000, "en")).toBe("Checking start");
    expect(formatCompactLiveStart("invalid", Date.now(), "ko")).toBe("시작 확인 중");
  });

  it("uses server live/ended/cancelled states independently of the start date", () => {
    const event = { startsAt: "2099-01-01T00:00:00Z", effectiveStatus: "live" as const };
    expect(liveTimeLabel(event, Date.now(), "ko")).toBe("LIVE 진행중");
    expect(liveTimeLabel({ ...event, effectiveStatus: "ended" }, null, "ko")).toBe("종료");
    expect(liveTimeLabel({ ...event, effectiveStatus: "cancelled" }, null, "en")).toBe("Cancelled");
    expect(liveTimeLabel({ ...event, effectiveStatus: "scheduled" }, null, "ko")).toBe("LIVE 예정");
  });
});
