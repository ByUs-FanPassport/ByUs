import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseLiveCalendarRepository } from "./live-calendar-repository";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "kara-live",
  startsAt: "2026-09-15T11:00:00.000Z",
  effectiveStatus: "scheduled",
  title: "KARA LIVE",
  celebrity: { name: "KARA", image: "/images/kara.jpg" },
  reservationState: null,
  hasBenefit: null,
};

describe("SupabaseLiveCalendarRepository", () => {
  it("uses one bounded service-role RPC and fills all calendar days", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [event], error: null });
    const repository = new SupabaseLiveCalendarRepository({ rpc });

    const result = await repository.readMonth({
      month: "2026-09",
      locale: "ko",
      appUserId: null,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_live_calendar_month", {
      p_app_user_id: null,
      p_locale: "ko",
      p_starts_at: "2026-08-31T15:00:00.000Z",
      p_ends_at: "2026-09-30T15:00:00.000Z",
      p_now: "2026-09-03T00:00:00.000Z",
    });
    expect(result).toMatchObject({ month: "2026-09", timeZone: "Asia/Seoul" });
    expect(result.days).toHaveLength(30);
    expect(result.days.find(({ date }) => date === "2026-09-15")?.events).toEqual([event]);
  });

  it("keeps guest reservation state unknown even if a malformed data source attempts to leak it", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...event, reservationState: "reserved", reservationId: "secret", reservedAt: "2026-09-01T00:00:00Z" }],
      error: null,
    });
    const repository = new SupabaseLiveCalendarRepository({ rpc });

    await expect(repository.readMonth({
      month: "2026-09",
      locale: "ko",
      appUserId: null,
      now: new Date("2026-09-03T00:00:00.000Z"),
    })).rejects.toThrow();
  });

  it("passes only the authenticated owner to the RPC and projects reserved/not-reserved without identifiers", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { ...event, reservationState: "reserved" },
        { ...event, id: "22222222-2222-4222-8222-222222222222", slug: "elina-live", startsAt: "2026-09-16T11:00:00.000Z", title: "ELINA LIVE", reservationState: "not_reserved" },
      ],
      error: null,
    });
    const repository = new SupabaseLiveCalendarRepository({ rpc });
    const result = await repository.readMonth({ month: "2026-09", locale: "en", appUserId: "owner-1", now: new Date("2026-09-03T00:00:00Z") });

    expect(rpc).toHaveBeenCalledWith("get_live_calendar_month", expect.objectContaining({ p_app_user_id: "owner-1" }));
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"reservationState":"reserved"');
    expect(serialized).toContain('"reservationState":"not_reserved"');
    expect(serialized).not.toMatch(/reservationId|reservedAt|appUserId|owner-1/i);
  });

  it("redacts database details and rejects invalid public projections", async () => {
    const failed = new SupabaseLiveCalendarRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "secret SQL detail" } }) });
    await expect(failed.readMonth({ month: "2026-09", locale: "ko", appUserId: null, now: new Date() })).rejects.toThrow("LIVE calendar lookup failed");

    const invalid = new SupabaseLiveCalendarRepository({ rpc: vi.fn().mockResolvedValue({ data: [{ ...event, effectiveStatus: "draft" }], error: null }) });
    await expect(invalid.readMonth({ month: "2026-09", locale: "ko", appUserId: null, now: new Date() })).rejects.toThrow();
  });
});
