import type { Route } from "next";

// The existing immutable slug is also the public handle. Keep this list aligned
// with top-level app routes and public asset directories (checked by tests).
export const RESERVED_CREATOR_HANDLES = [
  "admin", "api", "benefits", "bias", "c", "celebrities", "connect", "creator",
  "guide", "live", "login", "my", "notifications", "onboarding", "pages",
  "passports", "privacy", "s", "settings", "stamps", "terms",
  "fonts", "images", "share", "_next", ".well-known",
] as const;

export function isCreatorHandle(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && !(RESERVED_CREATOR_HANDLES as readonly string[]).includes(value);
}

export function creatorHomeHref(slug: string, locale?: "ko" | "en"): Route {
  return `/${encodeURIComponent(slug)}${locale ? `?locale=${locale}` : ""}` as Route;
}

/** Recognize the new home and old stored login/attribution targets only. */
export function creatorSlugFromHomePath(path: string): string | null {
  const slug = /^\/(?:c\/)?([^/]+)\/?$/.exec(path)?.[1];
  return slug && isCreatorHandle(slug) ? slug : null;
}
