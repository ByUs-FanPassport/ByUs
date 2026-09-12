import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (loader: () => Promise<unknown>) => loader }));

import { createCachedTikTokLiveObserver } from "./cached-tiktok-live-source";
import type { TikTokLiveObservation } from "./tiktok-live-source";

const now = new Date("2026-09-12T12:02:00.000Z");
const live = (observedAt: string): TikTokLiveObservation => ({ state: "live", observedAt, title: "방송 중", thumbnailUrl: null });

describe("cached TikTok LIVE source", () => {
  it("returns a cached explicit offline observation within 90 seconds", async () => {
    const offline = { state: "offline" as const, observedAt: "2026-09-12T12:01:00.001Z" };
    const source = vi.fn(async () => offline);
    const observe = createCachedTikTokLiveObserver({ source, now: () => now });
    await expect(observe("creator")).resolves.toEqual(offline);
    expect(source).toHaveBeenCalledOnce();
  });

  it("awaits a direct refresh when Next returns an observation aged 90 seconds", async () => {
    const stale = live("2026-09-12T12:00:30.000Z");
    const fresh = live("2026-09-12T12:01:59.000Z");
    const source = vi.fn().mockResolvedValueOnce(fresh);
    const cache = vi.fn((loader: () => Promise<unknown>) => {
      void loader;
      return async () => stale;
    });
    const observe = createCachedTikTokLiveObserver({ source, cache: cache as never, now: () => now });
    await expect(observe("creator")).resolves.toEqual(fresh);
    expect(source).toHaveBeenCalledOnce();
  });

  it("throws from the cached loader on transient unavailable and does not affirm offline", async () => {
    const source = vi.fn(async () => ({ state: "unavailable" as const, observedAt: now.toISOString() }));
    let loaderFailure: unknown;
    const cache = vi.fn((loader: () => Promise<unknown>) => async () => {
      try { await loader(); } catch (error) { loaderFailure = error; }
      throw loaderFailure;
    });
    const observe = createCachedTikTokLiveObserver({ source, cache: cache as never, now: () => now });
    await expect(observe("creator")).resolves.toEqual({ state: "unavailable", observedAt: now.toISOString() });
    expect(loaderFailure).toEqual(new Error("TikTok LIVE source unavailable"));
  });

  it("deduplicates concurrent stale direct refreshes for the same handle", async () => {
    const stale = live("2026-09-12T12:00:00.000Z");
    let release: ((value: TikTokLiveObservation) => void) | undefined;
    const source = vi.fn(() => new Promise<TikTokLiveObservation>((resolve) => { release = resolve; }));
    const cache = vi.fn(() => async () => stale);
    const observe = createCachedTikTokLiveObserver({ source, cache: cache as never, now: () => now });
    const first = observe("creator");
    const second = observe("creator");
    await vi.waitFor(() => expect(source).toHaveBeenCalledOnce());
    const fresh = { state: "offline" as const, observedAt: now.toISOString() };
    release?.(fresh);
    await expect(Promise.all([first, second])).resolves.toEqual([fresh, fresh]);
  });

  it("does not deduplicate direct refreshes across handles", async () => {
    const stale = live("2026-09-12T12:00:00.000Z");
    const source = vi.fn(async (handle: string) => ({ state: "offline" as const, observedAt: `${handle === "one" ? "2026-09-12T12:01:58" : "2026-09-12T12:01:59"}.000Z` }));
    const cache = vi.fn(() => async () => stale);
    const observe = createCachedTikTokLiveObserver({ source, cache: cache as never, now: () => now });
    const results = await Promise.all([observe("one"), observe("two")]);
    expect(results.map((result) => result.observedAt)).toEqual(["2026-09-12T12:01:58.000Z", "2026-09-12T12:01:59.000Z"]);
    expect(source).toHaveBeenCalledTimes(2);
  });
});
