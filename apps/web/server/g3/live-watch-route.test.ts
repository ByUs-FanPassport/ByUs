import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OBSERVED_LIVE_MAX_AGE_MS } from "../../features/live/domain/observed-live";
import type { LiveEventResponse } from "../../features/live/domain/live-event";
import type { PublishedCelebrity } from "../content/content-domain";
import { createGetLiveWatchHandler } from "./live-watch-route";

const fallback = "https://www.tiktok.com/live/event/7611111111111111111";
const startsAt = "2026-09-12T01:00:00.000Z";
const endsAt = "2026-09-12T02:00:00.000Z";
const current = "2026-09-12T01:30:00.000Z";

function live(overrides: Partial<LiveEventResponse["live"]> = {}): LiveEventResponse {
  return {
    live: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "ifew-live",
      effectiveStatus: "live",
      startsAt,
      endsAt,
      reservationOpensAt: "2026-09-01T00:00:00.000Z",
      reservationClosesAt: startsAt,
      title: "이퓨 LIVE",
      description: "함께 시청해요",
      productContext: "라이브",
      heroImage: { url: "/hero.jpg", alt: "이퓨" },
      celebrity: {
        slug: "ifewknow",
        name: "이퓨",
        image: "/ifew.jpg",
        fanCount: 1,
      },
      brand: {
        slug: "byus",
        name: "ByUs",
        logo: "/logo.svg",
        websiteUrl: null,
      },
      watch: {
        available: true,
        mode: "live",
        provider: "tiktok",
        url: fallback,
      },
      ...overrides,
    },
    viewer: { authenticated: false, passport: "missing", reservation: null },
    primaryAction: "watch_live",
  };
}

function creator(
  links: PublishedCelebrity["socialLinks"] = [
    { platform: "tiktok", url: "https://www.tiktok.com/@ifewknow" },
  ],
  slug = "ifewknow",
): PublishedCelebrity {
  return {
    slug,
    locale: "ko",
    name: "이퓨",
    summary: "소개",
    image: { url: "/ifew.jpg", alt: "이퓨", position: "center" },
    roles: ["creator"],
    themes: [],
    socialLinks: links,
    displayOrder: 0,
    fanCount: 1,
  };
}

function setup(options: {
  result?: LiveEventResponse | null;
  creatorResult?: PublishedCelebrity | null;
  observeResult?: { state: "live" | "offline" | "unavailable"; observedAt: string; title?: string; thumbnailUrl?: string | null };
  observeError?: Error;
  repositoryError?: Error;
  times?: string[];
} = {}) {
  const findPublishedBySlug = options.repositoryError
    ? vi.fn().mockRejectedValue(options.repositoryError)
    : vi.fn().mockResolvedValue(options.result === undefined ? live() : options.result);
  const findBySlug = vi.fn().mockResolvedValue(
    options.creatorResult === undefined ? creator() : options.creatorResult,
  );
  const observe = options.observeError
    ? vi.fn().mockRejectedValue(options.observeError)
    : vi.fn().mockResolvedValue(options.observeResult ?? {
        state: "live",
        observedAt: current,
        title: "방송 중",
        thumbnailUrl: null,
      });
  const times = options.times ?? [current, current, current];
  let timeIndex = 0;
  const now = vi.fn(() => new Date(times[Math.min(timeIndex++, times.length - 1)]!));
  return {
    findPublishedBySlug,
    findBySlug,
    observe,
    run: createGetLiveWatchHandler({
      repository: { findPublishedBySlug },
      creators: { findBySlug },
      observe,
      now,
    }),
  };
}

async function location(target: ReturnType<typeof setup>, url = "https://byus.test/api/live-events/ifew-live/watch?locale=ko", slug = "ifew-live") {
  const response = await target.run(new Request(url), { slug });
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.headers.get("location");
}

describe("GET live watch handler", () => {
  it("redirects a fresh observed LIVE scheduled event to the creator handle", async () => {
    const target = setup();
    await expect(location(
      target,
      "https://byus.test/api/live-events/ifew-live/watch",
    )).resolves.toBe(
      "https://www.tiktok.com/@ifewknow/live",
    );
    expect(target.findPublishedBySlug).toHaveBeenCalledWith({
      slug: "ifew-live",
      locale: "ko",
      appUserId: null,
      now: new Date(current),
    });
    expect(target.findBySlug).toHaveBeenCalledWith("ko", "ifewknow");
    expect(target.observe).toHaveBeenCalledWith("ifewknow");
  });

  it.each([
    ["offline", { state: "offline", observedAt: current }],
    ["unavailable", { state: "unavailable", observedAt: current }],
    ["stale", { state: "live", observedAt: new Date(Date.parse(current) - OBSERVED_LIVE_MAX_AGE_MS).toISOString(), title: "", thumbnailUrl: null }],
    ["future", { state: "live", observedAt: new Date(Date.parse(current) + 1).toISOString(), title: "", thumbnailUrl: null }],
  ] as const)("uses the stored URL for a %s observation", async (_name, observeResult) => {
    await expect(location(setup({ observeResult }))).resolves.toBe(fallback);
  });

  it("uses the stored URL when observation throws", async () => {
    await expect(location(setup({ observeError: new Error("origin detail") }))).resolves.toBe(fallback);
  });

  it("rechecks the event window after awaiting the observer", async () => {
    const target = setup({
      times: [current, current, endsAt],
      observeResult: { state: "live", observedAt: endsAt, title: "Still broadcasting", thumbnailUrl: null },
    });
    await expect(location(target)).resolves.toBe(fallback);
    expect(target.observe).toHaveBeenCalledOnce();
  });

  it.each(["2026-09-12T00:59:59.000Z", endsAt])("does not use another broadcast outside the event window (%s)", async (time) => {
    const target = setup({ times: [time] });
    await expect(location(target)).resolves.toBe(fallback);
    expect(target.observe).not.toHaveBeenCalled();
  });

  it.each(["scheduled", "ended", "cancelled"] as const)(
    "does not observe a %s event",
    async (effectiveStatus) => {
      const target = setup({ result: live({ effectiveStatus }) });
      await expect(location(target)).resolves.toBe(fallback);
      expect(target.observe).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["tiktok", "https://www.tiktok.com/@registered/live"],
    ["youtube", "https://www.youtube.com/watch?v=registered"],
  ] as const)("preserves explicit direct %s watch URLs without observing", async (provider, direct) => {
    const target = setup({ result: live({ watch: { available: true, mode: "live", provider, url: direct } }) });
    await expect(location(target)).resolves.toBe(direct);
    expect(target.findBySlug).not.toHaveBeenCalled();
    expect(target.observe).not.toHaveBeenCalled();
  });

  it.each([
    ["unlisted", null],
    ["mismatched", creator(undefined, "someone-else")],
    ["invalid TikTok URL", creator([{ platform: "tiktok", url: "https://tiktok.com/@ifewknow" }])],
    ["ambiguous handles", creator([
      { platform: "tiktok", url: "https://www.tiktok.com/@ifewknow" },
      { platform: "tiktok", url: "https://www.tiktok.com/@other" },
    ])],
  ] as const)("uses the stored URL for a %s creator profile", async (_name, creatorResult) => {
    const target = setup({ creatorResult });
    await expect(location(target)).resolves.toBe(fallback);
    expect(target.observe).not.toHaveBeenCalled();
  });

  it("ignores redirect-looking query parameters", async () => {
    const target = setup();
    await expect(location(
      target,
      "https://byus.test/api/live-events/ifew-live/watch?locale=ko&target=https://evil.test&handle=attacker",
    )).resolves.toBe("https://www.tiktok.com/@ifewknow/live");
  });

  it("rejects an unsafe registered fallback instead of redirecting", async () => {
    const target = setup({
      result: live({ watch: { available: true, mode: "live", provider: "tiktok", url: "https://www.tiktok.com.evil.test/live/event/7611111111111111111" } }),
    });
    const response = await target.run(new Request("https://byus.test/watch"), { slug: "ifew-live" });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(target.observe).not.toHaveBeenCalled();
  });

  it("validates the slug and locale before reading", async () => {
    const invalidSlug = setup();
    const slugResponse = await invalidSlug.run(new Request("https://byus.test/watch"), { slug: "Bad Slug" });
    expect(slugResponse.status).toBe(404);
    expect(slugResponse.headers.get("cache-control")).toBe("no-store");
    expect(invalidSlug.findPublishedBySlug).not.toHaveBeenCalled();

    const missingSlug = setup();
    expect((await missingSlug.run(new Request("https://byus.test/watch"), { slug: "" })).status).toBe(404);
    expect(missingSlug.findPublishedBySlug).not.toHaveBeenCalled();

    const invalidLocale = setup();
    const localeResponse = await invalidLocale.run(new Request("https://byus.test/watch?locale=ko-KR"), { slug: "ifew-live" });
    expect(localeResponse.status).toBe(400);
    expect(localeResponse.headers.get("cache-control")).toBe("no-store");
    expect(invalidLocale.findPublishedBySlug).not.toHaveBeenCalled();
  });

  it("returns no-store 404 and 503 responses for missing content and read failures", async () => {
    const missing = await setup({ result: null }).run(
      new Request("https://byus.test/watch"),
      { slug: "ifew-live" },
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");

    const failed = await setup({ repositoryError: new Error("database detail") }).run(
      new Request("https://byus.test/watch"),
      { slug: "ifew-live" },
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
  });
});
