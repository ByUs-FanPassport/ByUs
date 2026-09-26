import { parseCanonicalInstagramProfileUrl } from "./instagram-live";
import { parseYouTubeChannelUrl } from "./youtube-channel";

type WatchableLive = Readonly<{
  slug: string;
  effectiveStatus: string;
  watch: Readonly<{ provider: string; url: string }>;
}>;

/** Only scheduled event URLs opt in; explicit watch/replay URLs stay authoritative. */
export function isTikTokScheduledEventUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com") &&
      !url.port && !url.username && !url.password &&
      /^\/live\/event\/[1-9]\d{0,31}\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function liveWatchHref(live: WatchableLive, locale: string): string {
  const discoverable = (live.watch.provider === "tiktok" && isTikTokScheduledEventUrl(live.watch.url)) ||
    (live.watch.provider === "youtube" && parseYouTubeChannelUrl(live.watch.url) !== null) ||
    (live.watch.provider === "instagram" && parseCanonicalInstagramProfileUrl(live.watch.url) !== null);
  if (!discoverable || live.effectiveStatus !== "live") return live.watch.url;
  return `/api/live-events/${encodeURIComponent(live.slug)}/watch?locale=${encodeURIComponent(locale)}`;
}

/** A recording must be a specific video/post, never a profile, channel or scheduled event. */
export function isRecordedReplayUrl(provider: string, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return false;
    const patterns: Record<string, RegExp> = {
      youtube: /^https:\/\/((www\.)?youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}([?&][^\s]*)?$/,
      instagram: /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$/,
      tiktok: /^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.]+\/video\/[0-9]+\/?$/,
      chzzk: /^https:\/\/chzzk\.naver\.com\/video\/[0-9]+\/?$/,
    };
    return patterns[provider]?.test(value) ?? false;
  } catch { return false; }
}
