import type { LiveEventResponse } from "@/features/live/domain/live-event";
function isLiveEventResponse(item: unknown): item is LiveEventResponse {
  return Boolean(
    item
    && typeof item === "object"
    && "live" in item
    && item.live
    && typeof item.live === "object"
    && "slug" in item.live
    && typeof item.live.slug === "string"
    && "celebrity" in item.live
    && item.live.celebrity
    && typeof item.live.celebrity === "object"
    && "slug" in item.live.celebrity
    && typeof item.live.celebrity.slug === "string"
  );
}

export function flattenLiveCatalog(value: unknown): LiveEventResponse[] {
  if (!value || typeof value !== "object") return [];
  const catalog = value as Record<string, unknown>;
  return ["liveNow", "upcoming", "replay"]
    .flatMap((key) => Array.isArray(catalog[key]) ? catalog[key] : [])
    .filter(isLiveEventResponse);
}
