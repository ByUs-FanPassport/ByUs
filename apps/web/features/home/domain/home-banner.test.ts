import { describe, expect, it } from "vitest";
import { bannerFixture } from "../../../e2e/banner-local/fixture";
import { bannerPublicationIssues, homeBannerCommandSchema, homeBannerSchema, isBannerHref, localizedBannerHref } from "./home-banner";

describe("independent home banner contract", () => {
  it.each(["//evil.test", "/\\evil.test", "javascript:alert(1)", "data:text/html,hello", "http://example.test", "https://user:pass@example.test", "/path\nnext", "https:relative"])("rejects unsafe destination %s", href => {
    expect(isBannerHref(href)).toBe(false);
  });
  it("preserves internal filters and hash while selecting the active language", () => {
    expect(localizedBannerHref("/live/calendar?celebrity=elina&locale=ko#schedule", "en")).toBe("/live/calendar?celebrity=elina&locale=en#schedule");
    expect(localizedBannerHref("https://example.test/?locale=ko", "en")).toBe("https://example.test/?locale=ko");
    expect(isBannerHref("https://www.youtube.com/@elina")).toBe(true);
    expect(isBannerHref("https://www.tiktok.com/@elina")).toBe(true);
    expect(isBannerHref("https://user@example.test")).toBe(false);
  });
  it("requires both languages before publishing and never borrows an image across languages", () => {
    const ready = { title: "Title", description: "", ctaLabel: "Schedule", href: "/live/calendar", alt: "Artwork", desktopImage: bannerFixture.desktopImage, mobileImage: null };
    expect(bannerPublicationIssues({ kind: "regular_live", celebrityId: bannerFixture.celebrityId, localizations: { ko: ready, en: ready } })).toEqual([]);
    expect(bannerPublicationIssues({ kind: "regular_live", celebrityId: bannerFixture.celebrityId, localizations: { ko: ready, en: { ...ready, desktopImage: null } } })).toEqual(["en.desktopImage"]);
  });
  it("permits an incomplete draft but requires a creator for regular broadcasts", () => {
    const blank = { title: "", description: "", ctaLabel: "", href: "", alt: "", desktopAssetId: null, mobileAssetId: null };
    const command = { action: "save", id: null, expectedRevision: 0, kind: "announcement", celebrityId: null, localizations: { ko: blank, en: blank } };
    expect(homeBannerCommandSchema.safeParse(command).success).toBe(true);
    expect(homeBannerCommandSchema.safeParse({ ...command, kind: "regular_live" }).success).toBe(false);
  });
  it("rejects malformed public records and duplicate reorder ids", () => {
    expect(homeBannerSchema.safeParse({ ...bannerFixture, desktopImage: null }).success).toBe(false);
    const item = { id: bannerFixture.id, expectedRevision: 1 };
    expect(homeBannerCommandSchema.safeParse({ action: "reorder", items: [item, item] }).success).toBe(false);
  });
});
