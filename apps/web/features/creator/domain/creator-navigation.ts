import type { AppLocale } from "@/i18n/locales";

// The existing immutable slug is also the public handle. Keep this list aligned
// with top-level app routes and public asset directories (checked by tests).
export const RESERVED_CREATOR_HANDLES = [
  "admin", "api", "benefits", "bias", "c", "celebrities", "connect", "creator",
  "go", "guide", "live", "login", "my", "notifications", "o", "onboarding", "pages",
  "passports", "privacy", "s", "settings", "stamps", "t", "terms",
  "fonts", "images", "share", "_next", ".well-known",
] as const;

export function isCreatorHandle(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && !(RESERVED_CREATOR_HANDLES as readonly string[]).includes(value);
}

// Keep the path narrow when callers append queries; a full Route union expands
// every app route inside each template and can exceed TypeScript's depth limit.
export function creatorHomeHref(slug: string, locale?: AppLocale): `/${string}` {
  return `/${encodeURIComponent(slug)}${locale ? `?locale=${locale}` : ""}`;
}

/** Recognize the new home and old stored login/attribution targets only. */
export function creatorSlugFromHomePath(path: string): string | null {
  const slug = /^\/(?:c\/)?([^/]+)\/?$/.exec(path)?.[1];
  return slug && isCreatorHandle(slug) ? slug : null;
}
