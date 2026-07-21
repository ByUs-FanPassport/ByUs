import { describe, expect, it } from "vitest";

import {
  createGoogleCalendarUrl,
  deriveEffectiveLiveStatus,
  deriveLivePrimaryAction,
  parseExactYouTubeUrl,
  type LiveViewer,
} from "./live-event";

const guest: LiveViewer = { authenticated: false, passport: "missing", reservation: null };

describe("live event domain", () => {
  it("derives lifecycle from the server clock and gives cancellation precedence", () => {
    const base = { startsAt: "2026-07-24T11:00:00.000Z", endsAt: "2026-07-24T12:00:00.000Z", overrides: [] };
    expect(deriveEffectiveLiveStatus({ ...base, sourceStatus: "scheduled", now: new Date("2026-07-24T10:59:59Z") })).toBe("scheduled");
    expect(deriveEffectiveLiveStatus({ ...base, sourceStatus: "scheduled", now: new Date("2026-07-24T11:00:00Z") })).toBe("live");
    expect(deriveEffectiveLiveStatus({ ...base, sourceStatus: "scheduled", now: new Date("2026-07-24T12:00:00Z") })).toBe("ended");
    expect(deriveEffectiveLiveStatus({ ...base, sourceStatus: "cancelled", now: new Date("2026-07-24T11:30:00Z") })).toBe("cancelled");
  });

  it("uses only an active latest override", () => {
    expect(deriveEffectiveLiveStatus({
      sourceStatus: "scheduled", startsAt: "2026-07-24T11:00:00Z", endsAt: "2026-07-24T12:00:00Z",
      now: new Date("2026-07-24T10:00:00Z"),
      overrides: [
        { effectiveStatus: "live", effectiveFrom: "2026-07-24T09:00:00Z", effectiveUntil: null, createdAt: "2026-07-24T09:00:00Z" },
        { effectiveStatus: "ended", effectiveFrom: "2026-07-24T09:30:00Z", effectiveUntil: null, createdAt: "2026-07-24T09:30:00Z" },
      ],
    })).toBe("ended");
  });

  it("implements the approved half-open reservation interval", () => {
    const base = { status: "scheduled" as const, reservationOpensAt: "2026-07-20T00:00:00Z", reservationClosesAt: "2026-07-24T11:00:00Z", viewer: guest };
    expect(deriveLivePrimaryAction({ ...base, now: new Date("2026-07-19T23:59:59Z") })).toBe("reservation_upcoming");
    expect(deriveLivePrimaryAction({ ...base, now: new Date("2026-07-20T00:00:00Z") })).toBe("sign_in_to_reserve");
    expect(deriveLivePrimaryAction({ ...base, now: new Date("2026-07-24T11:00:00Z") })).toBe("reservation_closed");
  });

  it("allows only exact HTTPS YouTube watch, live, embed, and short links", () => {
    expect(parseExactYouTubeUrl("https://www.youtube.com/watch?v=abc_DEF-1")).toContain("youtube.com/watch");
    expect(parseExactYouTubeUrl("https://youtu.be/abc_DEF-1")).toContain("youtu.be");
    expect(() => parseExactYouTubeUrl("https://youtube.com.evil.test/watch?v=abc")).toThrow();
    expect(() => parseExactYouTubeUrl("https://user@youtube.com/watch?v=abc")).toThrow();
    expect(() => parseExactYouTubeUrl("https://youtube.com:444/watch?v=abc")).toThrow();
  });

  it("builds a calendar URL containing UTC dates and canonical ByUs live URL", () => {
    const result = new URL(createGoogleCalendarUrl({ canonicalAppUrl: "https://byus.example", liveSlug: "kara-move-again", title: "KARA LIVE", startsAt: "2026-07-24T11:00:00Z", endsAt: "2026-07-24T12:00:00Z", description: "함께 시청해요" }));
    expect(result.origin).toBe("https://calendar.google.com");
    expect(result.searchParams.get("dates")).toBe("20260724T110000Z/20260724T120000Z");
    expect(result.searchParams.get("details")).toContain("https://byus.example/live/kara-move-again");
  });
});
