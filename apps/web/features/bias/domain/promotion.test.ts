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
        "여러분, 제 라이브 팬페이지가 ByUs에 오픈되었어요!\n매주 라이브 스케줄도 확인하시고,\n좋아요💜랑 출석체크로 다양한 혜택도 꼭 받아가세요!\n" +
        url,
      bio: "라이브 스케줄과 다양한 소식은 이제 ByUs에서 확인하세요!\n" + url,
      story:
        "곧 라이브에서 만나요 💜\nByUs에서 라이브 출석도 기록하고 예쁜 스탬프도 꼭 받아가세요!\n" +
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
        "Hi, everyone! My LIVE fan page is now open on ByUs!\nCheck out my weekly LIVE schedule,\nand be sure to enjoy a variety of benefits by leaving a like 💜 and checking in!\n" +
        url,
      bio: "Check my LIVE schedule and more updates on ByUs!\n" + url,
      story:
        "See you at my LIVE soon 💜\nLog your LIVE check-ins on ByUs and be sure to collect the cute stamps!\n" +
        url,
      live: "My fan page is byus.kr/elina.\nCheck my LIVE schedule and ways to join in,\nand join me with likes and check-ins!",
    });
  });
});
