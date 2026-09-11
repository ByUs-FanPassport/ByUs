import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OBSERVED_LIVE_MAX_AGE_MS,
  isObservedLiveCardFresh,
} from "../../../../features/live/domain/observed-live";
import type { PublishedCelebrity } from "../../../../server/content/content-domain";
import { buildObservedLiveFeed } from "../../../../server/tiktok/observed-live-feed";
import {
  fetchTikTokLiveObservation,
  parseCanonicalTikTokProfileUrl,
} from "../../../../server/tiktok/tiktok-live-source";
import { createGetObservedLiveNow } from "./route";

const observedAt = "2026-09-11T01:00:00.000Z";

function celebrity(
  slug: string,
  tiktokUrl: string | null,
  locale: "ko" | "en" = "ko",
): PublishedCelebrity {
  return {
    slug,
    locale,
    name: slug === "ifewknow" ? "이퓨" : slug,
    summary: "공개 소개",
    image: { url: `/${slug}.jpg`, alt: slug, position: "center" },
    roles: ["creator"],
    themes: [],
    socialLinks:
      tiktokUrl === null ? [] : [{ platform: "tiktok", url: tiktokUrl }],
    displayOrder: 0,
    fanCount: 0,
  };
}

function sourceResponse(
  handle: string,
  status: unknown,
  roomId: unknown = "7611111111111111111",
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json({
    statusCode: 0,
    data: {
      user: { uniqueId: handle, roomId },
      liveRoom: {
        status,
        title: "지금 방송 중",
        coverUrl: "https://p16-common-sign.tiktokcdn.com/live-cover.jpeg",
      },
    },
    ...overrides,
  });
}

describe("TikTok LIVE source", () => {
  it("accepts only canonical public TikTok profile URLs", () => {
    expect(
      parseCanonicalTikTokProfileUrl("https://www.tiktok.com/@ifewknow"),
    ).toBe("ifewknow");
    expect(
      parseCanonicalTikTokProfileUrl("https://www.tiktok.com/@ifew.know_/"),
    ).toBe("ifew.know_");
    for (const invalid of [
      "http://www.tiktok.com/@ifewknow",
      "https://tiktok.com/@ifewknow",
      "https://www.tiktok.com/@ifewknow/live",
      "https://www.tiktok.com/@ifewknow?lang=ko",
      "https://www.tiktok.com.evil.test/@ifewknow",
      "https://www.tiktok.com/@bad%2Fhandle",
    ]) {
      expect(parseCanonicalTikTokProfileUrl(invalid)).toBeNull();
    }
  });

  it("classifies only status 2 with an exact handle and numeric room id as live", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      sourceResponse("wowtree777", 2),
    );
    await expect(
      fetchTikTokLiveObservation("wowtree777", {
        fetchImpl,
        now: () => new Date(observedAt),
      }),
    ).resolves.toEqual({
      state: "live",
      observedAt,
      title: "지금 방송 중",
      thumbnailUrl:
        "https://p16-common-sign.tiktokcdn.com/live-cover.jpeg",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=wowtree777&sourceType=54",
    );
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(new Headers(init?.headers).get("user-agent")).toBe("Mozilla/5.0");
    expect(new Headers(init?.headers).get("cookie")).toBeNull();
  });

  it("keeps a completed room offline and rejects unknown, null, mismatched, or invalid active states", async () => {
    const now = () => new Date(observedAt);
    await expect(
      fetchTikTokLiveObservation("ifewknow", {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          sourceResponse("ifewknow", 4),
        ),
        now,
      }),
    ).resolves.toEqual({ state: "offline", observedAt });

    const invalidResponses = [
      sourceResponse("ifewknow", null),
      sourceResponse("ifewknow", 3),
      sourceResponse("someoneelse", 2),
      sourceResponse("ifewknow", 2, "not-numeric"),
      Response.json({ statusCode: 0, data: null }),
      Response.json({ statusCode: 19881007, data: null }),
    ];
    for (const response of invalidResponses) {
      await expect(
        fetchTikTokLiveObservation("ifewknow", {
          fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
          now,
        }),
      ).resolves.toEqual({ state: "unavailable", observedAt });
    }
  });

  it("fails closed on throttling, HTML, unsafe thumbnails, and oversized bodies", async () => {
    const now = () => new Date(observedAt);
    for (const response of [
      new Response("rate limited", { status: 429 }),
      new Response("<html>challenge</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(256 * 1024 + 1),
        },
      }),
    ]) {
      await expect(
        fetchTikTokLiveObservation("ifewknow", {
          fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
          now,
        }),
      ).resolves.toEqual({ state: "unavailable", observedAt });
    }

    const unsafeCover = sourceResponse("ifewknow", 2);
    const payload = await unsafeCover.json() as {
      data: { liveRoom: { coverUrl: string } };
    };
    payload.data.liveRoom.coverUrl = "https://tiktokcdn.com.evil.test/cover.jpg";
    await expect(
      fetchTikTokLiveObservation("ifewknow", {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)),
        now,
      }),
    ).resolves.toEqual({
      state: "live",
      observedAt,
      title: "지금 방송 중",
      thumbnailUrl: null,
    });
  });
});

describe("observed LIVE feed projection", () => {
  it("returns the exact public card schema with source-time expiry and safe fallbacks", async () => {
    const feed = await buildObservedLiveFeed(
      [celebrity("ifewknow", "https://www.tiktok.com/@ifewknow")],
      "ko",
      vi.fn().mockResolvedValue({
        state: "live",
        observedAt,
        title: "",
        thumbnailUrl: null,
      }),
      () => new Date("2026-09-11T01:00:30.000Z"),
    );

    expect(feed).toEqual({
      items: [
        {
          celebritySlug: "ifewknow",
          creatorName: "이퓨",
          handle: "ifewknow",
          title: "이퓨의 TikTok LIVE",
          thumbnailUrl: "/ifewknow.jpg",
          fallbackThumbnailUrl: "/ifewknow.jpg",
          watchUrl: "https://www.tiktok.com/@ifewknow/live",
          observedAt,
          expiresAt: "2026-09-11T01:01:30.000Z",
        },
      ],
      checkedAt: "2026-09-11T01:00:30.000Z",
      coverage: { live: 1, offline: 0, unavailable: 0, stale: 0 },
    });
    expect(feed.items[0]?.observedAt).toBe(observedAt);
    expect(
      Date.parse(feed.items[0]!.expiresAt) - Date.parse(feed.items[0]!.observedAt),
    ).toBe(OBSERVED_LIVE_MAX_AGE_MS);
    expect(isObservedLiveCardFresh(feed.items[0]!, Date.parse(feed.checkedAt))).toBe(true);
  });

  it("hides observations at the 90-second boundary instead of renewing their cache timestamp", async () => {
    const feed = await buildObservedLiveFeed(
      [celebrity("ifewknow", "https://www.tiktok.com/@ifewknow")],
      "ko",
      vi.fn().mockResolvedValue({
        state: "live",
        observedAt,
        title: "cached title",
        thumbnailUrl: null,
      }),
      () => new Date(Date.parse(observedAt) + OBSERVED_LIVE_MAX_AGE_MS),
    );
    expect(feed.items).toEqual([]);
    expect(feed.coverage).toEqual({
      live: 0,
      offline: 0,
      unavailable: 0,
      stale: 1,
    });
  });

  it("takes checkedAt after origin observations finish", async () => {
    let currentTime = "2026-09-11T01:00:00.000Z";
    const feed = await buildObservedLiveFeed(
      [celebrity("ifewknow", "https://www.tiktok.com/@ifewknow")],
      "ko",
      async () => {
        currentTime = "2026-09-11T01:00:04.000Z";
        return {
          state: "live",
          observedAt: currentTime,
          title: "origin result",
          thumbnailUrl: null,
        };
      },
      () => new Date(currentTime),
    );
    expect(feed.checkedAt).toBe("2026-09-11T01:00:04.000Z");
    expect(feed.coverage.live).toBe(1);
    expect(feed.items).toHaveLength(1);
  });

  it("queries only strict TikTok handles from the supplied published roster and contains partial failures", async () => {
    const observe = vi.fn(async (handle: string) => {
      if (handle === "broken") throw new Error("upstream detail");
      return handle === "offline"
        ? { state: "offline" as const, observedAt }
        : { state: "live" as const, observedAt, title: handle, thumbnailUrl: null };
    });
    const feed = await buildObservedLiveFeed(
      [
        celebrity("live", "https://www.tiktok.com/@livehandle"),
        celebrity("offline", "https://www.tiktok.com/@offline"),
        celebrity("broken", "https://www.tiktok.com/@broken"),
        celebrity("invalid", "https://tiktok.com/@untrusted"),
        celebrity("no-tiktok", null),
      ],
      "ko",
      observe,
      () => new Date("2026-09-11T01:00:10.000Z"),
    );
    expect(observe.mock.calls.map(([handle]) => handle).sort()).toEqual([
      "broken",
      "livehandle",
      "offline",
    ]);
    expect(feed.items.map(({ celebritySlug }) => celebritySlug)).toEqual(["live"]);
    expect(feed.coverage).toEqual({
      live: 1,
      offline: 1,
      unavailable: 2,
      stale: 0,
    });
  });

  it("limits origin checks to three concurrent handles", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const observer = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { state: "offline" as const, observedAt };
    });
    const pending = buildObservedLiveFeed(
      Array.from({ length: 5 }, (_, index) =>
        celebrity(`creator-${index}`, `https://www.tiktok.com/@creator${index}`),
      ),
      "ko",
      observer,
      () => new Date("2026-09-11T01:00:10.000Z"),
    );
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(5));
    releases.splice(0).forEach((release) => release());
    await pending;
    expect(maximum).toBe(3);
  });
});

describe("GET /api/public/live-now", () => {
  it("uses the fresh public locale roster and returns live items plus coverage with no-store", async () => {
    const list = vi.fn().mockResolvedValue([
      celebrity("ifewknow", "https://www.tiktok.com/@ifewknow"),
    ]);
    const response = await createGetObservedLiveNow({
      repository: { list },
      observe: vi.fn().mockResolvedValue({ state: "offline", observedAt }),
      now: () => new Date("2026-09-11T01:00:10.000Z"),
    })(new Request("https://byus.kr/api/public/live-now?locale=ko"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      items: [],
      checkedAt: "2026-09-11T01:00:10.000Z",
      coverage: { live: 0, offline: 1, unavailable: 0, stale: 0 },
    });
    expect(list).toHaveBeenCalledWith("ko");
  });

  it("rejects invalid locales before querying and maps content errors to 503", async () => {
    const list = vi.fn();
    const invalid = await createGetObservedLiveNow({ repository: { list } })(
      new Request("https://byus.kr/api/public/live-now?locale=ja"),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
    expect(await invalid.json()).toEqual({ error: "invalid_locale" });
    expect(list).not.toHaveBeenCalled();

    list.mockRejectedValue(new Error("service role key must not leak"));
    const unavailable = await createGetObservedLiveNow({ repository: { list } })(
      new Request("https://byus.kr/api/public/live-now?locale=en"),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(await unavailable.json()).toEqual({ error: "content_unavailable" });
  });
});
