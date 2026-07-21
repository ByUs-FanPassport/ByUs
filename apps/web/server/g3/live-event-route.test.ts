import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { LiveEventResponse } from "../../features/live/domain/live-event";
import { createGetLiveEventHandler } from "./live-event-route";

const payload = {
  live: {
    id: "11111111-1111-4111-8111-111111111111", slug: "kara-move-again", effectiveStatus: "scheduled", startsAt: "2026-07-24T11:00:00.000Z", endsAt: "2026-07-24T12:00:00.000Z", reservationOpensAt: "2026-07-20T00:00:00.000Z", reservationClosesAt: "2026-07-24T11:00:00.000Z", title: "KARA LIVE", description: "함께 시청해요", productContext: "여름 뷰티", heroImage: { url: "/hero.jpg", alt: "KARA" }, celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" }, brand: { slug: "meriq", name: "Meriq", logo: "/meriq.svg", websiteUrl: null }, watch: { available: false, url: "https://www.youtube.com/watch?v=abc" },
  },
  viewer: { authenticated: false, passport: "missing", reservation: null },
  primaryAction: "sign_in_to_reserve",
} satisfies LiveEventResponse;

function handler(options: { result?: LiveEventResponse | null; authorizeError?: Error } = {}) {
  const findPublishedBySlug = vi.fn().mockResolvedValue(options.result === undefined ? payload : options.result);
  return {
    findPublishedBySlug,
    run: createGetLiveEventHandler({
      repository: { findPublishedBySlug },
      authorize: async () => {
        if (options.authorizeError) throw options.authorizeError;
        return { appUserId: "user-1" };
      },
      now: () => new Date("2026-07-21T00:00:00Z"),
    }),
  };
}

describe("GET live event handler", () => {
  it("serves a KO guest projection by default with public revalidation", async () => {
    const target = handler();
    const response = await target.run(new Request("https://byus.example/api/live-events/kara-move-again"), { slug: "kara-move-again" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(target.findPublishedBySlug).toHaveBeenCalledWith(expect.objectContaining({ locale: "ko", appUserId: null }));
    expect(response.headers.get("cache-control")).toContain("s-maxage=30");
  });

  it("accepts only exact ko and en locales", async () => {
    const target = handler();
    const response = await target.run(new Request("https://byus.example/api/live-events/kara-move-again?locale=ko-KR"), { slug: "kara-move-again" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_LOCALE" } });
    expect(target.findPublishedBySlug).not.toHaveBeenCalled();
  });

  it("resolves an optional owner session and disables shared caching", async () => {
    const target = handler();
    const response = await target.run(new Request("https://byus.example/api/live-events/kara-move-again?locale=en", { headers: { authorization: "Bearer token" } }), { slug: "kara-move-again" });
    expect(target.findPublishedBySlug).toHaveBeenCalledWith(expect.objectContaining({ locale: "en", appUserId: "user-1" }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects an invalid supplied session instead of silently downgrading it", async () => {
    const target = handler({ authorizeError: new AuthError("AUTHENTICATION_REQUIRED", 401, "invalid") });
    const response = await target.run(new Request("https://byus.example/api/live-events/kara", { headers: { authorization: "Bearer bad" } }), { slug: "kara" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTHENTICATION_REQUIRED" } });
    expect(target.findPublishedBySlug).not.toHaveBeenCalled();
  });

  it("returns the same opaque 404 for invalid, missing, draft, or unpublished-parent content", async () => {
    const invalid = handler();
    expect((await invalid.run(new Request("https://byus.example"), { slug: "Private Live" })).status).toBe(404);
    const missing = handler({ result: null });
    const response = await missing.run(new Request("https://byus.example"), { slug: "private-live" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "LIVE_NOT_FOUND" } });
  });

  it("redacts repository failures behind a stable availability error", async () => {
    const run = createGetLiveEventHandler({ repository: { findPublishedBySlug: async () => { throw new Error("database detail"); } }, authorize: async () => ({ appUserId: "user" }), now: () => new Date() });
    const response = await run(new Request("https://byus.example"), { slug: "kara-live" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "LIVE_UNAVAILABLE" } });
  });
});
