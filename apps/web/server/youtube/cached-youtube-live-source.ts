import "server-only";
import { YOUTUBE_LIVE_RECHECK_MS } from "../../features/live/domain/youtube-channel";

import { createHash } from "node:crypto";

import {
  fetchYouTubeApiJson,
  fetchYouTubeLiveObservation,
  type YouTubeChannelTarget,
  type YouTubeLiveObservation,
  type YouTubeLiveObserver,
} from "./youtube-live-source";
import { fetchSharedYouTubeApi } from "./shared-api-cache";

const CHANNEL_CACHE_MS = 24 * 60 * 60 * 1_000;
const SEARCH_CACHE_MS = 60 * 60 * 1_000;
const VIDEO_CACHE_MS = YOUTUBE_LIVE_RECHECK_MS;
const MAX_CACHE_ENTRIES = 128;
const FETCHED_AT_HEADER = "x-byus-youtube-fetched-at";

type CacheEntry = Readonly<{
  expiresAt: number;
  response: Response;
}>;

type CachedObserverOptions = Readonly<{
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}>;

function stageTtl(url: URL): number | null {
  if (url.origin !== "https://www.googleapis.com") return null;
  if (url.pathname === "/youtube/v3/channels") return CHANNEL_CACHE_MS;
  if (url.pathname === "/youtube/v3/search") return SEARCH_CACHE_MS;
  if (url.pathname === "/youtube/v3/videos") return VIDEO_CACHE_MS;
  return null;
}

function cacheKey(url: URL): string {
  const safeUrl = new URL(url);
  const apiKeyHash = createHash("sha256").update(safeUrl.searchParams.get("key") ?? "missing").digest("hex");
  safeUrl.searchParams.delete("key");
  safeUrl.searchParams.sort();
  return `${apiKeyHash}:${safeUrl.toString()}`;
}

function pruneCache(cache: Map<string, CacheEntry>, nowMs: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= nowMs) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function createCachedYouTubeLiveObserver(
  options: CachedObserverOptions = {},
): YouTubeLiveObserver {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<Response>>();
  const freshInFlight = new Map<string, ReturnType<typeof fetchYouTubeApiJson>>();
  const underlyingFetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());

  const cachedFetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input,
    );
    const ttl = stageTtl(url);
    if (ttl === null) return underlyingFetcher(input, init);

    const key = cacheKey(url);
    const nowMs = now().getTime();
    const existing = cache.get(key);
    if (existing && existing.expiresAt > nowMs) {
      cache.delete(key);
      cache.set(key, existing);
      return existing.response.clone();
    }
    cache.delete(key);

    const pending = inFlight.get(key);
    if (pending) return (await pending).clone();

    const request = (async () => {
      const response = await underlyingFetcher(input, init);
      if (response.ok) {
        const headers = new Headers(response.headers);
        const existingFetchedAt = headers.get(FETCHED_AT_HEADER);
        const fetchedAtMs = existingFetchedAt === null ? nowMs : Date.parse(existingFetchedAt);
        if (!Number.isFinite(fetchedAtMs)) return response;
        if (existingFetchedAt === null) headers.set(FETCHED_AT_HEADER, new Date(fetchedAtMs).toISOString());
        const taggedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        const expiresAt = Math.min(nowMs + ttl, fetchedAtMs + ttl);
        if (expiresAt > nowMs) {
          pruneCache(cache, nowMs);
          cache.set(key, { expiresAt, response: taggedResponse.clone() });
        }
        return taggedResponse;
      }
      return response;
    })();
    inFlight.set(key, request);
    try {
      return (await request).clone();
    } finally {
      inFlight.delete(key);
    }
  };

  return (target) =>
    fetchYouTubeLiveObservation(target, {
      apiKey: options.apiKey,
      now,
      apiFetcher: (_stage, url) => fetchYouTubeApiJson(url, cachedFetcher, now().getTime()),
      freshApiFetcher: (stage, url) => {
        void stage;
        const key = cacheKey(url);
        const existing = freshInFlight.get(key);
        if (existing) return existing;
        const request = fetchYouTubeApiJson(url, underlyingFetcher, now().getTime());
        freshInFlight.set(key, request);
        void request.then(() => freshInFlight.delete(key), () => freshInFlight.delete(key));
        return request;
      },
    });
}

const productionObserver = createCachedYouTubeLiveObserver({ fetcher: fetchSharedYouTubeApi });

export async function getCachedYouTubeLiveObservation(
  target: YouTubeChannelTarget,
): Promise<YouTubeLiveObservation> {
  return productionObserver(target);
}
