import { describe, expect, it } from "vitest";
import { canonicalUrl, DEFAULT_SHARE_IMAGE, isPrivatePath, publicMetadata, shareImageUrl } from "./metadata";
import { buildSitemap } from "./sitemap";
import robots from "@/app/robots";
import { htmlLimitedBots } from "./bots";

describe("public search and sharing metadata", () => {
  it.each(["facebookexternalhit/1.1", "Twitterbot", "kakaotalk-scrap/1.0", "TelegramBot", "Yeti", "OAI-SearchBot"])("sends metadata in the head to %s", (agent) => {
    expect(htmlLimitedBots.test(agent)).toBe(true);
  });
  it("keeps self-canonicals distinct by language and drops tracking/filter/hash state", () => {
    expect(canonicalUrl("/?locale=en&utm_source=kakao&owned=1#start", "ko")).toBe("https://byus.kr/?locale=ko");
    const meta = publicMetadata({ path: "/live/ifew", locale: "en", title: "ifew LIVE | ByUs", description: "Meet ifew." });
    expect(meta.alternates).toEqual({ canonical: "https://byus.kr/live/ifew?locale=en", languages: { ko: "https://byus.kr/live/ifew?locale=ko", en: "https://byus.kr/live/ifew?locale=en" } });
    expect(meta.openGraph).toMatchObject({ title: "ifew LIVE | ByUs", type: "website", siteName: "ByUs", url: "https://byus.kr/live/ifew?locale=en", locale: "en_US", images: [{ url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: "ByUs | Your Bias" }] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [{ url: DEFAULT_SHARE_IMAGE }] });
  });
  it("does not advertise missing translations", () => {
    const meta = publicMetadata({ path: "/c/ifew", locale: "ko", locales: ["ko"], title: "이퓨", description: "이퓨 소식" });
    expect(meta.alternates?.languages).toEqual({ ko: "https://byus.kr/c/ifew?locale=ko" });
    expect(meta.openGraph).toMatchObject({ alternateLocale: [] });
  });
  it("resizes approved public assets without changing their source or crop", () => {
    const source = "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/lives/ifew/banner.png";
    const url = new URL(shareImageUrl(source));
    expect(url.pathname).toBe("/_next/image");
    expect(url.searchParams.get("url")).toBe(source);
    expect(url.searchParams.get("w")).toBe("1200");
    expect(shareImageUrl("https://external.example/photo.jpg")).toBe("https://external.example/photo.jpg");
  });
  it.each(["/my", "/my/rewards/id/recipient", "/admin/login", "/passports/id", "/stamps/id", "/settings", "/notifications", "/onboarding/profile", "/c/ifew/verify/result", "/live/ifew/missions", "/live/ifew/survey"])("excludes private %s", (path) => {
    expect(isPrivatePath(path)).toBe(true);
  });
  it("keeps robots crawlable for noindex discovery and lists the sitemap", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/connect/"] }, sitemap: "https://byus.kr/sitemap.xml" });
    expect(publicMetadata({ path: "/live/ifew-rehearsal", locale: "ko", title: "Rehearsal", description: "Rehearsal" }).robots).toEqual({ index: false, follow: false });
  });
});

describe("sitemap URL inclusion", () => {
  it("deduplicates, excludes personal/rehearsal URLs, includes ended URLs and only real language pairs", () => {
    const map = buildSitemap([
      { path: "/c/ifew", locale: "ko" }, { path: "/c/ifew", locale: "en" }, { path: "/c/ifew", locale: "ko" },
      { path: "/live/ended-event", locale: "ko" }, { path: "/live/ifew-rehearsal", locale: "ko" },
      { path: "/my", locale: "ko" }, { path: "/c/ifew/verify", locale: "ko" },
    ]);
    expect(map).toHaveLength(21);
    expect(new Set(map.map(({ url }) => url)).size).toBe(21);
    expect(map.some(({ url }) => url === "https://byus.kr/guide?locale=ko")).toBe(true);
    expect(map.some(({ url }) => url === "https://byus.kr/guide?locale=en")).toBe(true);
    expect(map.some(({ url }) => /rehearsal|\/my|\/verify/.test(url))).toBe(false);
    expect(map.find(({ url }) => url.includes("ended-event"))?.alternates?.languages).toEqual({ ko: "https://byus.kr/live/ended-event?locale=ko" });
    expect(map.every(({ url }) => /\?locale=(ko|en)$/.test(url))).toBe(true);
  });
});
