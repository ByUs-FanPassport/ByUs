import { type AppLocale } from "@/i18n/locales";
import { creatorSlugFromHomePath } from "@/features/creator/domain/creator-navigation";
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
    || creatorSlugFromHomePath(pathname) !== null
    || /^\/passports\/[0-9a-f-]{36}$/.test(pathname);
}

export function nextFanAction({ summary, lives, pathname, locale, completed, now = new Date() }: {
  summary: MySummary;
  completed: { profile: boolean; verify: boolean; reserve: boolean };
  lives?: readonly LiveEventResponse[];
  pathname: string;
  locale: AppLocale;
  now?: Date;
}): NextFanAction | null {
  const owned = summary.creators.filter((creator) => creator.passport);
  const creatorSlug = creatorSlugFromHomePath(pathname)
    ?? owned.find((creator) => pathname === `/passports/${creator.passport?.id}`)?.celebrity.slug;
  const creator = summary.creators.find((item) => item.celebrity.slug === creatorSlug);
  if (!completed.profile) {
    const returnTo = creatorSlug ? `/c/${creatorSlug}/verify?locale=${locale}` : `${pathname}?locale=${locale}`;
    return { step: "profile", href: appendLoginContext("/onboarding/profile", {
      returnTo, locale, entity: creatorSlug ?? null, intent: creatorSlug ? "passport" : null,
    }) };
  }
  if (!completed.verify) {
    return { step: "verify", href: creatorSlug ? `/c/${creatorSlug}/verify?locale=${locale}` : `/celebrities?locale=${locale}`,
      targetName: creator?.celebrity.name };
  }
  if (completed.reserve) return null;
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
