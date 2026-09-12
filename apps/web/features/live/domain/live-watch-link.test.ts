import { describe, expect, it } from "vitest";
import { isTikTokScheduledEventUrl, liveWatchHref } from "./live-watch-link";

describe("LIVE watch links", () => {
  const live = {
    slug: "ifew-100-days-tiktok-20260912", effectiveStatus: "live",
    watch: { provider: "tiktok", url: "https://www.tiktok.com/live/event/7680769355085185044" },
  };
  it("resolves an active scheduled TikTok link at click time", () => {
    expect(liveWatchHref(live, "ko")).toBe(`/api/live-events/${live.slug}/watch?locale=ko`);
    expect(liveWatchHref(live, "en")).toBe(`/api/live-events/${live.slug}/watch?locale=en`);
    expect(live.watch.url).toContain("/live/event/");
  });
  it("resolves active YouTube channel URLs and preserves inactive channels and Instagram profiles", () => {
    const youtube = { ...live, watch: { provider: "youtube", url: "https://youtube.com/@creator" } };
    expect(liveWatchHref(youtube, "en")).toContain("/watch?locale=en");
    expect(liveWatchHref({ ...youtube, effectiveStatus: "ended" }, "ko")).toBe(youtube.watch.url);
    const instagram = { ...live, watch: { provider: "instagram", url: "https://www.instagram.com/creator/" } };
    expect(liveWatchHref(instagram, "ko")).toBe(instagram.watch.url);
  });
  it.each(["scheduled", "ended", "cancelled"])("preserves the URL for %s events", (effectiveStatus) => {
    expect(liveWatchHref({ ...live, effectiveStatus }, "ko")).toBe(live.watch.url);
  });
  it.each([
    ["tiktok", "https://www.tiktok.com/@ifewknow/live"],
    ["tiktok", "https://www.tiktok.com/@ifewknow/video/123"],
    ["youtube", "https://www.youtube.com/watch?v=abc"],
    ["instagram", "https://www.instagram.com/ifewknow/live/"],
  ])("preserves explicit %s watch URLs", (provider, url) => {
    expect(liveWatchHref({ ...live, watch: { provider, url } }, "ko")).toBe(url);
  });
  it.each([
    "https://tiktok.com.evil.test/live/event/123",
    "https://www.tiktok.com@evil.test/live/event/123",
    "http://www.tiktok.com/live/event/123",
    "https://www.tiktok.com:444/live/event/123",
    "https://user@www.tiktok.com/live/event/123",
    "https://www.tiktok.com/live/event/abc",
    "https://www.tiktok.com/live/event/123/extra",
  ])("does not resolve malformed or untrusted event URL %s", (url) => {
    expect(isTikTokScheduledEventUrl(url)).toBe(false);
  });
});
