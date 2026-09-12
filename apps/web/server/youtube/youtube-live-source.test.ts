import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCachedYouTubeLiveObserver } from "./cached-youtube-live-source";
import {
  fetchYouTubeLiveObservation,
  type YouTubeChannelTarget,
} from "./youtube-live-source";

const CHANNEL_ID = `UC${"a".repeat(22)}`;
const OTHER_CHANNEL_ID = `UC${"b".repeat(22)}`;
const VIDEO_ID = "abcDEF123_-";
const NOW = new Date("2026-09-12T12:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function liveSearch(channelId = CHANNEL_ID): Record<string, unknown> {
  return {
    items: [
      {
        id: { videoId: VIDEO_ID },
        snippet: { channelId },
      },
    ],
  };
}

function liveVideo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [
      {
        id: VIDEO_ID,
        snippet: {
          channelId: CHANNEL_ID,
          liveBroadcastContent: "live",
        },
        status: { privacyStatus: "public" },
        liveStreamingDetails: {
          actualStartTime: "2026-09-12T11:30:00.000Z",
        },
        ...overrides,
      },
    ],
  };
}

function queueFetcher(...responses: Response[]): typeof fetch {
  const queue = [...responses];
  return vi.fn(async () => {
    const response = queue.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("fetchYouTubeLiveObservation", () => {
  it("resolves a handle and confirms the only live video against the channel", async () => {
    const fetcher = queueFetcher(
      jsonResponse({ items: [{ id: CHANNEL_ID }] }),
      jsonResponse(liveSearch()),
      jsonResponse(liveVideo()),
    );

    await expect(
      fetchYouTubeLiveObservation(
        { kind: "handle", value: "@byus_live" },
        { apiKey: "secret-key", fetcher, now: () => NOW },
      ),
    ).resolves.toEqual({
      state: "live",
      observedAt: NOW.toISOString(),
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      actualStartTime: "2026-09-12T11:30:00.000Z",
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(fetcher).mock.calls;
    const channelUrl = new URL(String(calls[0]?.[0]));
    const searchUrl = new URL(String(calls[1]?.[0]));
    const videoUrl = new URL(String(calls[2]?.[0]));
    expect(channelUrl.origin + channelUrl.pathname).toBe(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    expect(channelUrl.searchParams.get("forHandle")).toBe("@byus_live");
    expect(searchUrl.searchParams.get("eventType")).toBe("live");
    expect(searchUrl.searchParams.get("maxResults")).toBe("2");
    expect(videoUrl.searchParams.get("part")).toBe(
      "snippet,status,liveStreamingDetails",
    );
    expect(calls.every((call) => call[1]?.redirect === "error")).toBe(true);
  });

  it("returns offline for no search candidates and skips channel resolution for an id", async () => {
    const fetcher = queueFetcher(jsonResponse({ items: [] }));

    await expect(
      fetchYouTubeLiveObservation(
        { kind: "id", value: CHANNEL_ID },
        { apiKey: "key", fetcher, now: () => NOW },
      ),
    ).resolves.toEqual({
      state: "offline",
      observedAt: NOW.toISOString(),
      channelId: CHANNEL_ID,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(String(vi.mocked(fetcher).mock.calls[0]?.[0])).pathname).toBe(
      "/youtube/v3/search",
    );
  });

  it.each([
    [
      "multiple candidates",
      {
        items: [
          ...(liveSearch().items as unknown[]),
          ...(liveSearch().items as unknown[]),
        ],
      },
    ],
    ["a next page", { ...liveSearch(), nextPageToken: "more" }],
    ["a mismatched channel", liveSearch(OTHER_CHANNEL_ID)],
    ["a malformed video id", { items: [{ id: { videoId: "bad" }, snippet: { channelId: CHANNEL_ID } }] }],
  ])("rejects search results with %s", async (_label, searchBody) => {
    const fetcher = queueFetcher(jsonResponse(searchBody));
    const observation = await fetchYouTubeLiveObservation(
      { kind: "id", value: CHANNEL_ID },
      { apiKey: "key", fetcher, now: () => NOW },
    );

    expect(observation).toEqual({
      state: "unavailable",
      observedAt: NOW.toISOString(),
      channelId: CHANNEL_ID,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "ended",
      liveVideo({
        liveStreamingDetails: {
          actualStartTime: "2026-09-12T11:30:00.000Z",
          actualEndTime: "2026-09-12T11:59:00.000Z",
        },
      }),
    ],
    [
      "private",
      liveVideo({ status: { privacyStatus: "private" } }),
    ],
    [
      "not currently broadcasting",
      liveVideo({
        snippet: {
          channelId: CHANNEL_ID,
          liveBroadcastContent: "none",
        },
      }),
    ],
    [
      "from the future",
      liveVideo({
        liveStreamingDetails: {
          actualStartTime: "2026-09-12T12:00:01.000Z",
        },
      }),
    ],
    [
      "a mismatched id",
      liveVideo({ id: "zyxWVU987_-" }),
    ],
  ])("does not confirm a video that is %s", async (_label, videoBody) => {
    const fetcher = queueFetcher(
      jsonResponse(liveSearch()),
      jsonResponse(videoBody),
    );
    const observation = await fetchYouTubeLiveObservation(
      { kind: "id", value: CHANNEL_ID },
      { apiKey: "key", fetcher, now: () => NOW },
    );

    expect(observation.state).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not call the API without a key", async () => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "");
    const fetcher = vi.fn();
    await expect(
      fetchYouTubeLiveObservation(
        { kind: "id", value: CHANNEL_ID },
        { fetcher: fetcher as unknown as typeof fetch, now: () => NOW },
      ),
    ).resolves.toEqual({ state: "unavailable", observedAt: NOW.toISOString() });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-200 response", jsonResponse({ error: true }, 403)],
    ["malformed JSON", new Response("not-json", { headers: { "content-type": "application/json" } })],
    ["a non-JSON response", new Response("ok", { headers: { "content-type": "text/plain" } })],
  ])("maps %s to unavailable", async (_label, response) => {
    const observation = await fetchYouTubeLiveObservation(
      { kind: "id", value: CHANNEL_ID },
      { apiKey: "key", fetcher: queueFetcher(response), now: () => NOW },
    );
    expect(observation.state).toBe("unavailable");
  });

  it("bounds a request even when an injected fetcher ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    const pending = fetchYouTubeLiveObservation(
      { kind: "id", value: CHANNEL_ID },
      { apiKey: "key", fetcher, now: () => NOW },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({
      state: "unavailable",
      observedAt: NOW.toISOString(),
    });
    expect(vi.mocked(fetcher).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("also bounds a response whose JSON body stalls", async () => {
    vi.useFakeTimers();
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"items":'));
      },
    });
    const response = new Response(stalledBody, {
      headers: { "content-type": "application/json" },
    });
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
    const pending = fetchYouTubeLiveObservation(
      { kind: "id", value: CHANNEL_ID },
      { apiKey: "key", fetcher, now: () => NOW },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({
      state: "unavailable",
      observedAt: NOW.toISOString(),
    });
    expect(vi.mocked(fetcher).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe("createCachedYouTubeLiveObserver", () => {
  it("does not touch the network when the production key is absent", async () => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "");
    const fetcher = vi.fn();
    const observe = createCachedYouTubeLiveObserver({
      fetcher: fetcher as unknown as typeof fetch,
      now: () => NOW,
    });

    await expect(observe({ kind: "id", value: CHANNEL_ID })).resolves.toEqual({
      state: "unavailable",
      observedAt: NOW.toISOString(),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses separate stage TTLs while preserving the video evidence time", async () => {
    let clock = NOW.getTime();
    const now = () => new Date(clock);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/channels")) return jsonResponse({ items: [{ id: CHANNEL_ID }] });
      if (path.endsWith("/search")) return jsonResponse(liveSearch());
      if (path.endsWith("/videos")) return jsonResponse(liveVideo());
      throw new Error("unexpected endpoint");
    }) as unknown as typeof fetch;
    const observe = createCachedYouTubeLiveObserver({ apiKey: "key", fetcher, now });
    const target: YouTubeChannelTarget = { kind: "handle", value: "@byus_live" };

    const first = await observe(target);
    clock += 10_000;
    const cached = await observe(target);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(cached.observedAt).toBe(first.observedAt);

    clock += 21_000;
    const refreshed = await observe(target);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(refreshed.observedAt).toBe(new Date(clock).toISOString());
    expect(new URL(String(vi.mocked(fetcher).mock.calls[3]?.[0])).pathname).toBe(
      "/youtube/v3/videos",
    );

    clock += 270_000;
    await observe(target);
    expect(fetcher).toHaveBeenCalledTimes(6);
    const laterPaths = vi.mocked(fetcher).mock.calls.slice(4).map(
      ([input]) => new URL(String(input)).pathname,
    );
    expect(laterPaths).toEqual(["/youtube/v3/search", "/youtube/v3/videos"]);
  });
});
