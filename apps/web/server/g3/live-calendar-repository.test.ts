import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PublicImageLiveCalendarRepository, SupabaseLiveCalendarRepository } from "./live-calendar-repository";

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

  it("rejects role metadata injected by the RPC before the approved reader runs", async () => {
    const repository = new SupabaseLiveCalendarRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{ ...event, photos: { portrait: null } }],
        error: null,
      }),
    });

    await expect(repository.readMonth({
      month: "2026-09",
      locale: "ko",
      appUserId: null,
      now: new Date("2026-09-03T00:00:00.000Z"),
    })).rejects.toThrow("projection is invalid");
  });

  it("attaches event photos after strict RPC parsing with one batch read", async () => {
    const readLivePhotoSetsBySlug = vi.fn().mockResolvedValue({
      [event.slug]: { poster: null },
    });
    const repository = new PublicImageLiveCalendarRepository(
      new SupabaseLiveCalendarRepository({ rpc: vi.fn().mockResolvedValue({ data: [event], error: null }) }),
      { readLivePhotoSetsBySlug, readCelebrityPhotoSetsBySlug: vi.fn().mockResolvedValue({}) },
      { readByLiveSlugs: vi.fn().mockResolvedValue({}) },
    );

    const result = await repository.readMonth({
      month: "2026-09",
      locale: "ko",
      appUserId: null,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });

    expect(readLivePhotoSetsBySlug).toHaveBeenCalledExactlyOnceWith([event.slug]);
    expect(result.days.find(({ date }) => date === "2026-09-15")?.events[0]?.photos).toEqual({ poster: null });
  });

  it("attaches creator role photos and position with the event role photos in bounded batches", async () => {
    const secondEvent = {
      ...event,
      id: "22222222-2222-4222-8222-222222222222",
      slug: "other-live",
      celebrity: { name: "Other", image: "/images/other.jpg" },
    };
    const readLivePhotoSetsBySlug = vi.fn().mockResolvedValue({
      [event.slug]: { poster: null },
    });
    const readCelebrityPhotoSetsBySlug = vi.fn().mockResolvedValue({
      creator: { profile: null, portrait: null },
      other: { landscape: null },
    });
    const readByLiveSlugs = vi.fn().mockResolvedValue({
      [event.slug]: { celebritySlug: "creator", imagePosition: "50% 35%" },
      [secondEvent.slug]: { celebritySlug: "other", imagePosition: "center" },
    });
    const repository = new PublicImageLiveCalendarRepository(
      new SupabaseLiveCalendarRepository({ rpc: vi.fn().mockResolvedValue({ data: [event, secondEvent], error: null }) }),
      { readLivePhotoSetsBySlug, readCelebrityPhotoSetsBySlug },
      { readByLiveSlugs },
    );

    const result = await repository.readMonth({ month: "2026-09", locale: "ko", appUserId: null, now: new Date("2026-09-03T00:00:00.000Z") });
    const events = result.days.find(({ date }) => date === "2026-09-15")!.events;

    expect(readLivePhotoSetsBySlug).toHaveBeenCalledExactlyOnceWith([event.slug, secondEvent.slug]);
    expect(readByLiveSlugs).toHaveBeenCalledExactlyOnceWith([event.slug, secondEvent.slug]);
    expect(readCelebrityPhotoSetsBySlug).toHaveBeenCalledExactlyOnceWith(["creator", "other"]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slug: event.slug,
        photos: { poster: null },
        celebrity: expect.objectContaining({ imagePosition: "50% 35%", photos: { profile: null, portrait: null } }),
      }),
      expect.objectContaining({
        slug: secondEvent.slug,
        celebrity: expect.objectContaining({ imagePosition: "center", photos: { landscape: null } }),
      }),
    ]));
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
