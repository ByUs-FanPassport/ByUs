import "server-only";

import { unstable_cache } from "next/cache";

import {
  fetchTikTokLiveObservation,
  type TikTokLiveObservation,
} from "./tiktok-live-source";

const MAX_OBSERVATION_AGE_MS = 90_000;
const FRESH_LOOKUP_TIMEOUT_MS = 5_000;

type CacheFactory = <T extends () => Promise<unknown>>(
  loader: T,
  keyParts: string[],
  options: { revalidate: number },
) => T;

export function createCachedTikTokLiveObserver(options: {
  source?: typeof fetchTikTokLiveObservation;
  cache?: CacheFactory;
  now?: () => Date;
} = {}) {
  const source = options.source ?? fetchTikTokLiveObservation;
  const cache = options.cache ?? unstable_cache as CacheFactory;
  const now = options.now ?? (() => new Date());
  const freshInFlight = new Map<string, Promise<TikTokLiveObservation>>();

  const unavailable = (): TikTokLiveObservation => ({ state: "unavailable", observedAt: now().toISOString() });
  const loadCached = (handle: string) => cache(async () => {
    const observation = await source(handle);
    if (observation.state === "unavailable") throw new Error("TikTok LIVE source unavailable");
    return observation;
  }, ["observed-tiktok-live", handle], { revalidate: 30 })() as Promise<TikTokLiveObservation>;

  const loadFresh = (handle: string): Promise<TikTokLiveObservation> => {
    const existing = freshInFlight.get(handle);
    if (existing) return existing;
    const request = (async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("TikTok LIVE refresh timed out")), FRESH_LOOKUP_TIMEOUT_MS);
        });
        return await Promise.race([source(handle), timeout]);
      } catch {
        return unavailable();
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    })();
    freshInFlight.set(handle, request);
    void request.finally(() => freshInFlight.delete(handle));
    return request;
  };

  return async (handle: string): Promise<TikTokLiveObservation> => {
    let cached: TikTokLiveObservation;
    try {
      cached = await loadCached(handle);
    } catch {
      return unavailable();
    }
    const age = now().getTime() - Date.parse(cached.observedAt);
    if (Number.isFinite(age) && age >= 0 && age < MAX_OBSERVATION_AGE_MS) return cached;
    return loadFresh(handle);
  };
}

const productionObserver = createCachedTikTokLiveObserver();

export async function getCachedTikTokLiveObservation(handle: string): Promise<TikTokLiveObservation> {
  return productionObserver(handle);
}
