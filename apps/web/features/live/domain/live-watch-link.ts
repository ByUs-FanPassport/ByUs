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
  if (live.watch.provider !== "tiktok" || live.effectiveStatus !== "live" ||
      !isTikTokScheduledEventUrl(live.watch.url)) return live.watch.url;
  return `/api/live-events/${encodeURIComponent(live.slug)}/watch?locale=${encodeURIComponent(locale)}`;
}
