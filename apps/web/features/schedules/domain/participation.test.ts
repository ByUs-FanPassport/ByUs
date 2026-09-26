import { describe, expect, it } from "vitest";
import { socialProfileKey, scheduleInputSchema, scheduleWriteSchema } from "./participation";
import { localScheduleTime, scheduleInstant } from "./schedule-time";
import { isRecordedReplayUrl } from "@/features/live/domain/live-watch-link";
import { combinedCalendarDays } from "./calendar-entries";
const id = "10000000-0000-4000-8000-000000000001";
const input = { celebritySlug: "artist-one", kind: "concert", title: "Concert", description: "", startsAt: "2026-09-30T16:00:00Z", endsAt: "2026-09-30T17:00:00Z", timeZone: "Asia/Seoul", location: "", participationInstructions: "", sourceUrl: "https://example.test/event", locale: "ko", idempotencyKey: id };
describe("participation input and calendar integrity", () => {
  it("round-trips a chosen zone and rejects DST gaps/overlaps instead of shifting the event", () => {
    expect(scheduleInstant("2026-10-01T01:00", "Asia/Seoul")).toBe("2026-09-30T16:00:00.000Z");
    expect(localScheduleTime(input.startsAt, "Asia/Seoul")).toBe("2026-10-01T01:00");
    expect(() => scheduleInstant("2026-03-08T02:30", "America/New_York")).toThrow();
    expect(() => scheduleInstant("2026-11-01T01:30", "America/New_York")).toThrow();
    expect(() => scheduleInstant("2026-02-30T12:00", "UTC")).toThrow();
  });
  it("requires ordered times, official HTTPS and known fields", () => {
    expect(scheduleInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ endsAt: input.startsAt }, { sourceUrl: "https://user:secret@example.test/event" }, { timeZone: "Unknown/Zone" }, { appUserId: id }]) expect(scheduleInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    const { sourceUrl, celebritySlug: _slug, locale: _locale, idempotencyKey: _key, ...common } = input;
    expect(scheduleWriteSchema.safeParse({ ...common, celebrityId: id, title: { ko: "공연", en: "Concert" }, description: { ko: "", en: "" }, officialSourceUrl: sourceUrl, status: "published" }).success).toBe(true);
  });
  it("normalizes profiles but never accepts posts as a duplicate profile key", () => {
    expect(socialProfileKey("https://www.instagram.com/Artist.Name/")).toBe("instagram:artist.name");
    expect(socialProfileKey("https://instagram.com/p/abc/")).toBeNull();
    expect(socialProfileKey("https://youtube.com/watch?v=abcdefghijk")).toBeNull();
  });
  it("only accepts specific recordings, including cross-provider replay", () => {
    expect(isRecordedReplayUrl("youtube", "https://www.youtube.com/watch?v=abcdefghijk")).toBe(true);
    expect(isRecordedReplayUrl("tiktok", "https://www.tiktok.com/@creator/video/123456")).toBe(true);
    for (const url of ["https://youtube.com/@creator", "https://www.youtube.com/watch?v=abcdefghijk#bad", "https://youtube.com:444/watch?v=abcdefghijk", "https://youtube.com/live/abc"]) expect(isRecordedReplayUrl("youtube", url)).toBe(false);
    expect(isRecordedReplayUrl("tiktok", "https://www.tiktok.com/live/event/1234")).toBe(false);
  });
  it("groups by KST date while retaining exact creator identity for same-name artists", () => {
    const days = combinedCalendarDays({ month: "2026-10", timeZone: "Asia/Seoul", days: [{ date: "2026-10-01", events: [] }] }, [{ ...input, kind: "concert", id, celebrityId: id, celebrityName: "Same name", celebritySlug: "artist-one", officialSourceUrl: input.sourceUrl, status: "published", revision: 1, subscribed: null, detailHref: `/live/calendar/schedules/${id}` }], [{ slug: "artist-one", name: "Same name", image: "/one.webp" }, { slug: "artist-two", name: "Same name", image: "/two.webp" }], new Map());
    expect(days[0].events[0].artistSlug).toBe("artist-one"); expect(days[0].events[0].celebrity.image).toBe("/one.webp"); expect(days[0].events[0].schedule?.kind).toBe("concert");
  });
});
