import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LiveEventRecord, LiveEventDataSource } from "./live-event-repository";
import { DefaultLiveEventRepository } from "./live-event-repository";

const event: LiveEventRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "kara-move-again",
  sourceStatus: "scheduled",
  startsAt: "2026-07-24T11:00:00.000Z",
  endsAt: "2026-07-24T12:00:00.000Z",
  reservationOpensAt: "2026-07-20T00:00:00.000Z",
  reservationClosesAt: "2026-07-24T11:00:00.000Z",
  youtubeUrl: "https://www.youtube.com/watch?v=abc_DEF-1",
  heroUrl: "/images/live/kara.jpg",
  title: "KARA LIVE — Move Again",
  description: "YouTube에서 함께 시청해요.",
  heroAlt: "KARA 라이브",
  celebrity: { id: "22222222-2222-4222-8222-222222222222", slug: "kara", name: "KARA", image: "/images/kara.jpg" },
  brand: { slug: "meriq", name: "Meriq", logo: "/images/meriq.svg", websiteUrl: "https://meriq.example", productContext: "여름 뷰티 루틴" },
  overrides: [],
};

function source(overrides: Partial<LiveEventDataSource> = {}): LiveEventDataSource {
  return {
    findPublishedEvent: async () => event,
    findViewer: async () => ({ hasPassport: false, reservation: null }),
    ...overrides,
  };
}

describe("DefaultLiveEventRepository", () => {
  it("returns only the public localized projection for a guest", async () => {
    const result = await new DefaultLiveEventRepository(source()).findPublishedBySlug({ slug: event.slug, locale: "ko", appUserId: null, now: new Date("2026-07-21T00:00:00Z") });
    expect(result).toMatchObject({
      live: { slug: event.slug, effectiveStatus: "scheduled", productContext: "여름 뷰티 루틴", watch: { available: false } },
      viewer: { authenticated: false, passport: "missing", reservation: null },
      primaryAction: "sign_in_to_reserve",
    });
    expect(JSON.stringify(result)).not.toMatch(/fan.?code|actor|reason|wallet|job.?payload/i);
  });

  it("returns owner passport and reservation summary without chain job details", async () => {
    const reservation = {
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-21T01:00:00.000Z",
      stamp: { id: "44444444-4444-4444-8444-444444444444", businessStatus: "issued" as const, mintStatus: "queued" as const },
    };
    const result = await new DefaultLiveEventRepository(source({ findViewer: async () => ({ hasPassport: true, reservation }) })).findPublishedBySlug({ slug: event.slug, locale: "en", appUserId: "user", now: new Date("2026-07-21T00:00:00Z") });
    expect(result?.viewer).toEqual({ authenticated: true, passport: "active", reservation });
    expect(result?.primaryAction).toBe("reserved");
  });

  it("preserves opaque not-found behavior", async () => {
    const result = await new DefaultLiveEventRepository(source({ findPublishedEvent: async () => null })).findPublishedBySlug({ slug: "private-live", locale: "ko", appUserId: "user", now: new Date() });
    expect(result).toBeNull();
  });
});
