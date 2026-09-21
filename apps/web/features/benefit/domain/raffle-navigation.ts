import type { AppLocale } from "@/i18n/locales";
import type { Route } from "next";
import type { BenefitLocale } from "./benefit";

/** Every creator uses the same catalog, including creators with one gift. */
export function creatorRaffleVerificationHref(slug: string, locale: AppLocale, benefitId?: string | null) {
  const returnTo = benefitId ? `/c/${slug}/raffles/${benefitId}?locale=${locale}` : `/c/${slug}/raffles?locale=${locale}`;
  return `/c/${slug}/verify?${new URLSearchParams({ locale, returnTo }).toString()}` as Route;
}

export function creatorRafflesHref(slug: string, locale: AppLocale): Route {
  return `/c/${encodeURIComponent(slug)}/raffles?locale=${locale}` as Route;
}

/** The dedicated route avoids the generic benefit drawer interception. */
export function creatorRaffleHref(slug: string, benefitId: string, locale: AppLocale): Route {
  return `/c/${encodeURIComponent(slug)}/raffles/${encodeURIComponent(benefitId)}?locale=${locale}` as Route;
}
