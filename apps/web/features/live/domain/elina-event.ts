export const elinaLiveSlug = "elina-banksy-instagram-20260918";

export function elinaLiveHref(locale: "ko" | "en") {
  return `/live/${elinaLiveSlug}?locale=${locale}` as const;
}

export function elinaVerificationHref(locale: "ko" | "en") {
  const query = new URLSearchParams({ locale, returnTo: elinaLiveHref(locale) });
  return `/c/elina/verify?${query.toString()}` as const;
}

export function elinaRafflesHref(locale: "ko" | "en") {
  return `/c/elina?tab=raffles&locale=${locale}#celebrity-content` as const;
}
