import { z } from "zod";

export const OBSERVED_LIVE_MAX_AGE_MS = 90_000;
export const OBSERVED_LIVE_POLL_MS = 30_000;
export type ObservedLivePlatform = "tiktok" | "youtube";
export type ObservedLiveCard = {
  platform?: ObservedLivePlatform;
  celebritySlug: string;
  creatorName: string;
  handle: string;
  title: string;
  thumbnailUrl: string;
  fallbackThumbnailUrl?: string;
  watchUrl: string;
  observedAt: string;
  expiresAt: string;
};
export type ObservedLiveTarget = {
  celebritySlug: string;
  platform: ObservedLivePlatform;
  handle: string;
  state: "live" | "offline" | "unavailable" | "stale";
  observedAt: string | null;
};
export type ObservedLiveFeed = {
  items: ObservedLiveCard[];
  targets?: ObservedLiveTarget[];
  checkedAt: string;
  coverage: { live: number; offline: number; unavailable: number; stale: number };
};
export function observedLiveKey(item: Pick<ObservedLiveCard, "platform" | "celebritySlug" | "handle">): string {
  return JSON.stringify([item.platform ?? "tiktok", item.celebritySlug, item.handle]);
}
export function isObservedLiveCardFresh(card: Pick<ObservedLiveCard, "observedAt" | "expiresAt">, now = Date.now()): boolean {
  const observedAt = Date.parse(card.observedAt), expiresAt = Date.parse(card.expiresAt);
  return Number.isFinite(observedAt) && Number.isFinite(expiresAt) && observedAt <= now && now < expiresAt && expiresAt - observedAt === OBSERVED_LIVE_MAX_AGE_MS;
}
const label = z.string().max(2048);
const platform = z.enum(["tiktok", "youtube"]);
const httpsUrl = label.refine((value) => {
  if (/^\/(?!\/)[^\\]*$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
});
const cardSchema = z.object({
  platform: platform.optional(), celebritySlug: label, creatorName: label, handle: label,
  title: label, thumbnailUrl: httpsUrl, fallbackThumbnailUrl: httpsUrl.optional(), watchUrl: label,
  observedAt: label, expiresAt: label,
}).refine((card) => card.platform === "youtube"
  ? /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(card.watchUrl)
  : /^[A-Za-z0-9._]{2,24}$/.test(card.handle) && card.watchUrl === `https://www.tiktok.com/@${card.handle}/live`);
const feedSchema = z.object({
  items: z.array(cardSchema).max(1000),
  targets: z.array(z.object({ platform, celebritySlug: label, handle: label, state: z.enum(["live", "offline", "unavailable", "stale"]), observedAt: label.nullable() })).max(1000),
  checkedAt: label,
  coverage: z.object({ live: z.number().nonnegative(), offline: z.number().nonnegative(), unavailable: z.number().nonnegative(), stale: z.number().nonnegative() }),
});
/** A malformed/failed response cannot erase still-valid prior observations. */
export function mergeObservedLiveFeed(previous: ObservedLiveCard[], response: unknown, now = Date.now()): ObservedLiveCard[] {
  const current = previous.filter((item) => isObservedLiveCardFresh(item, now));
  const parsed = feedSchema.safeParse(response);
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.checkedAt)) || Date.parse(parsed.data.checkedAt) > now) return current;
  const feed = parsed.data;
  const targetKeys = feed.targets.map(observedLiveKey);
  if (new Set(targetKeys).size !== targetKeys.length) return current;
  const incoming = new Map(feed.items.filter((item) => isObservedLiveCardFresh(item, now)).map((item) => [observedLiveKey(item), item]));
  const old = new Map(current.map((item) => [observedLiveKey(item), item]));
  const merged: ObservedLiveCard[] = [];
  for (const target of feed.targets) {
    const key = observedLiveKey(target), prior = old.get(key), next = incoming.get(key);
    const at = target.observedAt === null ? NaN : Date.parse(target.observedAt);
    const targetFresh = Number.isFinite(at) && at <= now && now - at < OBSERVED_LIVE_MAX_AGE_MS;
    if (target.state === "live" && next && next.observedAt === target.observedAt) {
      merged.push(prior && Date.parse(prior.observedAt) > Date.parse(next.observedAt) ? prior : next);
    } else if (prior && !(target.state === "offline" && targetFresh && at >= Date.parse(prior.observedAt))) {
      merged.push(prior);
    }
  }
  return merged;
}
