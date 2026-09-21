import { type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__bias__domain__promotion";
import { translate, additionalLocales } from "@/i18n/messages";
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
  locale: AppLocale,
): PromotionCopy {
  const shortUrl = `byus.kr/${slug}`;
  const url = `https://${shortUrl}${locale === "ko" ? "" : `?locale=${locale}`}`;

  const copy = {ko: {url,
shortUrl,
general: `여러분, 제 라이브 팬페이지가 ByUs에 오픈되었어요!
매주 라이브 스케줄도 확인하시고,
좋아요💜랑 출석체크로 다양한 혜택도 꼭 받아가세요!
${url}`,
bio: `라이브 스케줄과 다양한 소식은 이제 ByUs에서 확인하세요!
${url}`,
story: `곧 라이브에서 만나요 💜
ByUs에서 라이브 출석도 기록하고 예쁜 스탬프도 꼭 받아가세요!
${url}`,
live: `제 팬페이지는 ${shortUrl}예요.
라이브 일정과 참여할 수 있는 활동을 확인하고,
좋아요와 출석으로 함께해 주세요!`}, en: {url,
shortUrl,
general: `Hi, everyone! My LIVE fan page is now open on ByUs!
Check out my weekly LIVE schedule,
and be sure to enjoy a variety of benefits by leaving a like 💜 and checking in!
${url}`,
bio: `Check my LIVE schedule and more updates on ByUs!
${url}`,
story: `See you at my LIVE soon 💜
Log your LIVE check-ins on ByUs and be sure to collect the cute stamps!
${url}`,
live: `My fan page is ${shortUrl}.
Check my LIVE schedule and ways to join in,
and join me with likes and check-ins!`},
  ...additionalLocales((translationLocale) => ({url,
shortUrl,
general: translate(translationLocale, localizedMessages.m08ee38c69565, "Hi, everyone! My LIVE fan page is now open on ByUs!\nCheck out my weekly LIVE schedule,\nand be sure to enjoy a variety of benefits by leaving a like 💜 and checking in!\n{0}", [url]),
bio: translate(translationLocale, localizedMessages.m03b30b02220c, "Check my LIVE schedule and more updates on ByUs!\n{0}", [url]),
story: translate(translationLocale, localizedMessages.m3b9adafe4d7e, "See you at my LIVE soon 💜\nLog your LIVE check-ins on ByUs and be sure to collect the cute stamps!\n{0}", [url]),
live: translate(translationLocale, localizedMessages.mebb43a6cd00d, "My fan page is {0}.\nCheck my LIVE schedule and ways to join in,\nand join me with likes and check-ins!", [shortUrl])}))
};
  return copy[locale];
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
