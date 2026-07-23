import { describe, expect, it } from "vitest";

import {
  parseContentLocale,
  parsePublishedCelebrity,
  parsePublishedCelebrityLive,
  parsePublishedCelebritySlug,
} from "./content-domain";

const completeRow = {
  slug: "kara",
  locale: "ko",
  name: "KARA",
  summary: "공개 소개",
  image_url: "/images/guest-home/kara-card.jpg",
  image_alt: "KARA 멤버",
  image_position: "center 46%",
  themes: [{ slug: "beauty", name: "뷰티" }],
  social_links: [{ platform: "youtube", url: "https://youtube.com/@kara" }],
  display_order: 0,
  fan_count: 12_800_000,
};

describe("published content boundary", () => {
  it.each(["kara", "kara-2026", "ss501"])("accepts canonical slug %s", (slug) => {
    expect(parsePublishedCelebritySlug(slug)).toBe(slug);
  });

  it.each(["KARA", " kara", "kara_2026", "-kara", "kara-"])(
    "rejects non-canonical slug %s",
    (slug) => expect(() => parsePublishedCelebritySlug(slug)).toThrow(),
  );

  it("supports only the planned Korean and English locales", () => {
    expect(parseContentLocale("ko")).toBe("ko");
    expect(parseContentLocale("en")).toBe("en");
    expect(() => parseContentLocale("ja")).toThrow();
  });

  it("accepts a complete safe published projection", () => {
    expect(parsePublishedCelebrity(completeRow)).toEqual({
      slug: "kara",
      locale: "ko",
      name: "KARA",
      summary: "공개 소개",
      image: {
        url: "/images/guest-home/kara-card.jpg",
        alt: "KARA 멤버",
        position: "center 46%",
      },
      themes: [{ slug: "beauty", name: "뷰티" }],
      socialLinks: [{ platform: "youtube", url: "https://youtube.com/@kara" }],
      displayOrder: 0,
      fanCount: 12_800_000,
    });
  });

  it.each(["name", "summary", "image_alt"])(
    "rejects an incomplete published projection missing %s",
    (field) => {
      expect(() =>
        parsePublishedCelebrity({ ...completeRow, [field]: "" }),
      ).toThrow();
    },
  );

  it("rejects unsupported social platforms and unsafe URLs", () => {
    expect(() =>
      parsePublishedCelebrity({
        ...completeRow,
        social_links: [{ platform: "facebook", url: "https://facebook.com/kara" }],
      }),
    ).toThrow();
    expect(() =>
      parsePublishedCelebrity({
        ...completeRow,
        social_links: [{ platform: "youtube", url: "javascript:alert(1)" }],
      }),
    ).toThrow();
  });

  it("accepts only public scheduled or live discovery summaries", () => {
    expect(
      parsePublishedCelebrityLive({
        slug: "kara-live",
        celebrity_slug: "kara",
        locale: "ko",
        title: "KARA LIVE",
        starts_at: "2026-07-24T11:00:00.000+00:00",
        effective_status: "scheduled",
      }),
    ).toEqual({
      slug: "kara-live",
      celebritySlug: "kara",
      locale: "ko",
      title: "KARA LIVE",
      startsAt: "2026-07-24T11:00:00.000+00:00",
      effectiveStatus: "scheduled",
    });
    expect(() =>
      parsePublishedCelebrityLive({
        slug: "old-live",
        celebrity_slug: "kara",
        locale: "ko",
        title: "Old LIVE",
        starts_at: "2026-07-20T11:00:00.000+00:00",
        effective_status: "ended",
      }),
    ).toThrow();
  });
});
