import type { PublishedCelebrity } from "@/server/content/content-domain";

export type PromotionProfile = Pick<
  PublishedCelebrity,
  "slug" | "name" | "image" | "socialLinks"
>;

export type PromotionCopy = Readonly<{
  url: string;
  shortUrl: string;
  general: string;
  bio: string;
  story: string;
  live: string;
}>;

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function promotionCopy(
  slug: string,
  locale: "ko" | "en",
): PromotionCopy {
  const shortUrl = `byus.kr/${slug}`;
  const url = `https://${shortUrl}${locale === "en" ? "?locale=en" : ""}`;

  if (locale === "ko") {
    return {
      url,
      shortUrl,
      general:
        "제 ByUs 팬페이지에 놀러 오세요 💜\n제 소식과 참여할 수 있는 활동을 확인하고,\n좋아요와 출석으로 함께해 주세요.\n이벤트와 혜택도 팬페이지에서 확인해 주세요!\n" +
        url,
      bio: "내 소식과 팬 활동은 여기서 💜\n" + url,
      story:
        "라이브 소식은 제 ByUs 팬페이지에서 확인해요 💜\n좋아요와 출석으로 팬 활동도 함께해요!\n" +
        url,
      live:
        "제 팬페이지는 " +
        shortUrl +
        "예요.\n라이브 일정과 참여할 수 있는 활동을 확인하고,\n좋아요와 출석으로 함께해 주세요!",
    };
  }

  return {
    url,
    shortUrl,
    general:
      "Visit my ByUs fan page 💜\nCheck out my updates and ways to join in,\nand join me with likes and check-ins.\nYou can also find events and benefits on my fan page!\n" +
      url,
    bio: "My updates and fan activities are here 💜\n" + url,
    story:
      "Find my LIVE updates on my ByUs fan page 💜\nJoin the fan activities with likes and check-ins!\n" +
      url,
    live:
      "My fan page is " +
      shortUrl +
      ".\nCheck my LIVE schedule and ways to join in,\nand join me with likes and check-ins!",
  };
}

export function searchProfiles(
  profiles: readonly PromotionProfile[],
  query: string,
): readonly PromotionProfile[] {
  const needle = normalized(query);
  if (!needle) return profiles;
  return profiles.filter((profile) => {
    return (
      normalized(profile.name).includes(needle) ||
      normalized(profile.slug).includes(needle)
    );
  });
}

/** The supplied public roster is the publication boundary; never substitute a profile. */
export function resolveProfile(
  profiles: readonly PromotionProfile[],
  slug: string,
): PromotionProfile | undefined {
  return profiles.find((profile) => profile.slug === slug);
}
