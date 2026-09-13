import { describe, expect, it } from "vitest";
import type { PromotionProfile } from "./promotion";
import { promotionCopy, resolveProfile, searchProfiles } from "./promotion";

function profile(slug: string, name = slug): PromotionProfile {
  return {
    slug,
    name,
    image: { url: `/images/${slug}.jpg`, alt: name, position: "center" },
    socialLinks: [],
  };
}

describe("promotion profiles", () => {
  it("searches a roster larger than 200 by normalized name or slug", () => {
    const profiles = Array.from({ length: 205 }, (_, index) =>
      profile(`creator-${index}`, `Creator ${index}`),
    );
    profiles[204] = profile("ifew", "IFew");

    expect(searchProfiles(profiles, "  IFEW ")).toEqual([profiles[204]]);
    expect(searchProfiles(profiles, "creator-203")).toEqual([profiles[203]]);
  });

  it("resolves only an exact member of the supplied public roster", () => {
    const publicProfiles = [profile("elina", "Elina"), profile("ifew", "ifew")];

    expect(resolveProfile(publicProfiles, "ifew")).toBe(publicProfiles[1]);
    expect(resolveProfile(publicProfiles, "ifewknow")).toBeUndefined();
    expect(resolveProfile(publicProfiles, "private-creator")).toBeUndefined();
    expect(resolveProfile([], "elina")).toBeUndefined();
  });
});

describe("promotion copy", () => {
  it("uses the selected public handle in every Korean variant", () => {
    const url = "https://byus.kr/ifew";
    expect(promotionCopy("ifew", "ko")).toEqual({
      url,
      shortUrl: "byus.kr/ifew",
      general:
        "제 ByUs 팬페이지에 놀러 오세요 💜\n제 소식과 참여할 수 있는 활동을 확인하고,\n좋아요와 출석으로 함께해 주세요.\n이벤트와 혜택도 팬페이지에서 확인해 주세요!\n" +
        url,
      bio: "내 소식과 팬 활동은 여기서 💜\n" + url,
      story:
        "라이브 소식은 제 ByUs 팬페이지에서 확인해요 💜\n좋아요와 출석으로 팬 활동도 함께해요!\n" +
        url,
      live: "제 팬페이지는 byus.kr/ifew예요.\n라이브 일정과 참여할 수 있는 활동을 확인하고,\n좋아요와 출석으로 함께해 주세요!",
    });
  });

  it("uses the selected public handle and English locale URL in every English variant", () => {
    const url = "https://byus.kr/elina?locale=en";
    expect(promotionCopy("elina", "en")).toEqual({
      url,
      shortUrl: "byus.kr/elina",
      general:
        "Visit my ByUs fan page 💜\nCheck out my updates and ways to join in,\nand join me with likes and check-ins.\nYou can also find events and benefits on my fan page!\n" +
        url,
      bio: "My updates and fan activities are here 💜\n" + url,
      story:
        "Find my LIVE updates on my ByUs fan page 💜\nJoin the fan activities with likes and check-ins!\n" +
        url,
      live: "My fan page is byus.kr/elina.\nCheck my LIVE schedule and ways to join in,\nand join me with likes and check-ins!",
    });
  });
});
