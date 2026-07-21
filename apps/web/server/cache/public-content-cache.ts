export const PUBLIC_CONTENT_CACHE_TAG = "byus-public-content";

/**
 * Public content freshness SLO:
 * - a successful admin publication command invalidates tagged CDN entries immediately;
 * - without an invalidation signal, edge entries revalidate within 60 seconds;
 * - browsers must always revalidate and never retain an independently stale copy.
 */
export const PUBLIC_CONTENT_CACHE_CONTROL =
  "public, max-age=0, must-revalidate, s-maxage=60, stale-while-revalidate=300";

export function publicContentCacheHeaders(): Record<string, string> {
  return {
    "cache-control": PUBLIC_CONTENT_CACHE_CONTROL,
    "vercel-cache-tag": PUBLIC_CONTENT_CACHE_TAG,
  };
}
