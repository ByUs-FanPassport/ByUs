import type { Route } from "next";
import type { BenefitLocale } from "./benefit";

/** Every creator uses the same catalog, including creators with one gift. */
export function creatorRafflesHref(slug: string, locale: BenefitLocale): Route {
  return `/c/${encodeURIComponent(slug)}/raffles?locale=${locale}` as Route;
}

/** The dedicated route avoids the generic benefit drawer interception. */
export function creatorRaffleHref(slug: string, benefitId: string, locale: BenefitLocale): Route {
  return `/c/${encodeURIComponent(slug)}/raffles/${encodeURIComponent(benefitId)}?locale=${locale}` as Route;
}
