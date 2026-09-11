import { deriveLivePrimaryAction, type LiveEventResponse } from "@/features/live/domain/live-event";
import type { MySummary } from "@/features/my/domain/my-summary";
import { appendLoginContext } from "@/components/login-intent";

export type NextFanAction = {
  step: "profile" | "verify" | "reserve";
  href: string;
  targetName?: string;
  liveTitle?: string;
};

// Only discovery and completed Passport pages: forms and active journeys own their next action.
export function supportsFanGuide(pathname: string, search: string) {
  const query = new URLSearchParams(search);
  if (query.has("authIntent") || query.has("intent")) return false;
  return ["/", "/my", "/celebrities", "/live"].includes(pathname)
    || /^\/c\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname)
    || /^\/passports\/[0-9a-f-]{36}$/.test(pathname);
}

export function nextFanAction({ summary, lives, pathname, locale, now = new Date() }: {
  summary: MySummary;
  lives?: readonly LiveEventResponse[];
  pathname: string;
  locale: "ko" | "en";
  now?: Date;
}): NextFanAction | null {
  const owned = summary.creators.filter((creator) => creator.passport);
  const creatorSlug = /^\/c\/([a-z0-9-]+)$/.exec(pathname)?.[1]
    ?? owned.find((creator) => pathname === `/passports/${creator.passport?.id}`)?.celebrity.slug;
  const creator = summary.creators.find((item) => item.celebrity.slug === creatorSlug);
  if (!summary.profile.nickname?.trim()) {
    const returnTo = creatorSlug ? `/c/${creatorSlug}/verify?locale=${locale}` : `${pathname}?locale=${locale}`;
    return { step: "profile", href: appendLoginContext("/onboarding/profile", {
      returnTo, locale, entity: creatorSlug ?? null, intent: creatorSlug ? "passport" : null,
    }) };
  }
  if ((creatorSlug && !creator?.passport) || owned.length === 0) {
    return { step: "verify", href: creatorSlug ? `/c/${creatorSlug}/verify?locale=${locale}` : `/celebrities?locale=${locale}`,
      targetName: creator?.celebrity.name };
  }
  const candidate = lives?.filter(({ live, viewer, primaryAction }) =>
    viewer.authenticated && (primaryAction === "reserve" || primaryAction === "reservation_upcoming")
    && (!creatorSlug || live.celebrity.slug === creatorSlug)
    && owned.some((item) => item.celebrity.slug === live.celebrity.slug)
    && deriveLivePrimaryAction({ status: live.effectiveStatus, reservationOpensAt: live.reservationOpensAt,
      reservationClosesAt: live.reservationClosesAt, viewer, now }) === "reserve",
  ).sort((a, b) => Date.parse(a.live.startsAt) - Date.parse(b.live.startsAt) || a.live.slug.localeCompare(b.live.slug))[0];
  return candidate ? { step: "reserve", href: `/live/${candidate.live.slug}?locale=${locale}`,
    targetName: candidate.live.celebrity.name, liveTitle: candidate.live.title } : null;
}
