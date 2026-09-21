import { type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__live__domain__ifew-event";
import { additionalLocales } from "@/i18n/messages";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";

export const ifewLiveSlug = "ifew-100-days-tiktok-20260912";
export const ifewEndedDescription = {
  ko: "이퓨의 틱톡 100일 기념 LIVE가 종료됐어요. 함께해 주셔서 감사합니다.",
  en: "ifew’s 100-day TikTok LIVE has ended. Thank you for joining us.",

  ...additionalLocales((translationLocale) => (localizedMessages.mdb097dc77839[translationLocale]))
} as const;

export const ifewBenefitId = "41ae7883-098e-49f2-9229-4f6962160141";

export function ifewLiveHref(locale: AppLocale) {
  return `/live/${ifewLiveSlug}?locale=${locale}` as const;
}

export function ifewVerificationHref(locale: AppLocale) {
  const query = new URLSearchParams({ locale, returnTo: ifewLiveHref(locale) });
  return `/c/ifewknow/verify?${query.toString()}` as const;
}

export function ifewRafflesHref(locale: AppLocale) {
  return creatorRafflesHref("ifewknow", locale);
}

export const ifewPrizeName = {
  ko: "더현대 서울 뱅크시 전시 관람권",
  en: "Banksy exhibition admission at The Hyundai Seoul",

  ...additionalLocales((translationLocale) => (localizedMessages.mbedcf6d86739[translationLocale]))
} as const;
