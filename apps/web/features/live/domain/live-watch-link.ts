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
