import { describe, expect, it } from "vitest";

import {
  buildLiveCalendarMonth,
  getLiveCalendarUtcBounds,
  liveCalendarMonthSchema,
  resolveLiveCalendarMonth,
} from "./live-calendar";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "kara-live",
  startsAt: "2026-08-31T15:30:00.000Z",
  effectiveStatus: "scheduled" as const,
  title: "KARA LIVE",
  celebrity: { name: "KARA", image: "/images/kara.jpg" },
  reservationState: null,
  hasBenefit: null,
};

describe("LIVE calendar domain", () => {
  it("falls back for malformed or repeated month query values", () => {
    expect(resolveLiveCalendarMonth("2026-09", "2026-08")).toBe("2026-09");
    expect(resolveLiveCalendarMonth("2026-9", "2026-08")).toBe("2026-08");
    expect(resolveLiveCalendarMonth(["2026-09", "2026-10"], "2026-08")).toBe("2026-08");
  });

  it("rejects unsafe celebrity image URLs", () => {
    expect(() => buildLiveCalendarMonth({
      month: "2026-09",
      events: [{ ...event, celebrity: { ...event.celebrity, image: "javascript:alert(1)" } }],
    })).toThrow();
  });

  it("converts an Asia/Seoul month to an exact half-open UTC interval", () => {
    expect(getLiveCalendarUtcBounds("2026-09")).toEqual({
      startsAt: "2026-08-31T15:00:00.000Z",
      endsAt: "2026-09-30T15:00:00.000Z",
    });
  });

  it.each(["2026-00", "2026-13", "26-09", "2026-9", "999-01", "10000-01"])(
    "rejects an invalid or unbounded month %s",
    (month) => {
      expect(() => getLiveCalendarUtcBounds(month)).toThrow();
    },
  );

  it("returns every KST day, including leap day, and groups a UTC timestamp on its next KST day", () => {
    const september = buildLiveCalendarMonth({ month: "2026-09", events: [event] });
    const leapFebruary = buildLiveCalendarMonth({ month: "2028-02", events: [] });
    const ordinaryFebruary = buildLiveCalendarMonth({ month: "2027-02", events: [] });

    expect(september.days).toHaveLength(30);
    expect(september.days[0]).toMatchObject({ date: "2026-09-01", events: [event] });
    expect(september.days.at(-1)?.date).toBe("2026-09-30");
    expect(leapFebruary.days).toHaveLength(29);
    expect(leapFebruary.days.at(-1)?.date).toBe("2028-02-29");
    expect(ordinaryFebruary.days).toHaveLength(28);
  });

  it("sorts same-day events deterministically by instant then slug and retains every effective status", () => {
    const result = buildLiveCalendarMonth({
      month: "2026-09",
      events: [
        { ...event, id: "22222222-2222-4222-8222-222222222222", slug: "z-live", startsAt: "2026-09-12T02:00:00.000Z", effectiveStatus: "ended" },
        { ...event, id: "33333333-3333-4333-8333-333333333333", slug: "b-live", startsAt: "2026-09-12T01:00:00.000Z", effectiveStatus: "live", celebrity: { name: "B", image: "/b.jpg" } },
        { ...event, id: "44444444-4444-4444-8444-444444444444", slug: "a-live", startsAt: "2026-09-12T01:00:00.000Z", effectiveStatus: "cancelled", celebrity: { name: "A", image: "/a.jpg" } },
      ],
    });

    const events = result.days.find(({ date }) => date === "2026-09-12")?.events ?? [];
    expect(events.map(({ slug }) => slug)).toEqual(["a-live", "b-live", "z-live"]);
    expect(events.map(({ effectiveStatus }) => effectiveStatus)).toEqual(["cancelled", "live", "ended"]);
  });

  it("validates the public-only shape and distinguishes unknown reservation and Benefit states", () => {
    const calendar = buildLiveCalendarMonth({ month: "2026-09", events: [event] });
    expect(liveCalendarMonthSchema.parse(calendar)).toEqual(calendar);
    expect(JSON.stringify(calendar)).not.toMatch(/appUserId|reservationId|reservedAt|passport|wallet/i);
    expect(calendar.days[0]?.events[0]).toMatchObject({
      reservationState: null,
      hasBenefit: null,
    });
  });
});
