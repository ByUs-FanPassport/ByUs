import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";

export const ifewLiveSlug = "ifew-100-days-tiktok-20260912";
export const ifewBenefitId = "41ae7883-098e-49f2-9229-4f6962160141";

export function ifewLiveHref(locale: "ko" | "en") {
  return `/live/${ifewLiveSlug}?locale=${locale}` as const;
}

export function ifewVerificationHref(locale: "ko" | "en") {
  const query = new URLSearchParams({ locale, returnTo: ifewLiveHref(locale) });
  return `/c/ifewknow/verify?${query.toString()}` as const;
}

export function ifewRafflesHref(locale: "ko" | "en") {
  return creatorRafflesHref("ifewknow", locale);
}

export const ifewPrizeName = {
  ko: "더현대 서울 뱅크시 전시 관람권",
  en: "Banksy exhibition admission at The Hyundai Seoul",
} as const;
