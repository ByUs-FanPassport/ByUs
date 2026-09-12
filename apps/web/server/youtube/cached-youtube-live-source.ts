import "server-only";

import {
  fetchYouTubeLiveObservation,
  type YouTubeChannelTarget,
  type YouTubeLiveObservation,
  type YouTubeLiveObserver,
} from "./youtube-live-source";

const CHANNEL_CACHE_MS = 24 * 60 * 60 * 1_000;
const SEARCH_CACHE_MS = 5 * 60 * 1_000;
const VIDEO_CACHE_MS = 30 * 1_000;
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
  safeUrl.searchParams.delete("key");
  safeUrl.searchParams.sort();
  return safeUrl.toString();
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
        headers.set(FETCHED_AT_HEADER, new Date(nowMs).toISOString());
        const taggedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        pruneCache(cache, nowMs);
        cache.set(key, {
          expiresAt: nowMs + ttl,
          response: taggedResponse.clone(),
        });
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
      fetcher: cachedFetcher,
      now,
    });
}

const productionObserver = createCachedYouTubeLiveObserver();

export async function getCachedYouTubeLiveObservation(
  target: YouTubeChannelTarget,
): Promise<YouTubeLiveObservation> {
  return productionObserver(target);
}
