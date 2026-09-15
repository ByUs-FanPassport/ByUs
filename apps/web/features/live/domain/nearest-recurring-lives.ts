import type { LiveEventResponse } from "./live-event";

export function nearestRecurringLives(items: readonly LiveEventResponse[]) {
  const creators = new Set<string>();
  return [...items].sort((a, b) => Date.parse(a.live.startsAt) - Date.parse(b.live.startsAt) || a.live.id.localeCompare(b.live.id)).filter(item => {
    if (item.live.liveType !== "recurring") return true;
    if (creators.has(item.live.celebrity.slug)) return false;
    creators.add(item.live.celebrity.slug);
    return true;
  });
}
