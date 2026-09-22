import { type AppLocale } from "@/i18n/locales";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";

export const elinaLiveSlug = "elina-banksy-instagram-20260918";

export function elinaLiveHref(locale: AppLocale) {
  return `/live/${elinaLiveSlug}?locale=${locale}` as const;
}

export function elinaVerificationHref(locale: AppLocale) {
  const query = new URLSearchParams({ locale, returnTo: elinaRafflesHref(locale) });
  return `/c/elina/verify?${query.toString()}` as const;
}

export function elinaRafflesHref(locale: AppLocale) {
  return creatorRafflesHref("elina", locale);
}
