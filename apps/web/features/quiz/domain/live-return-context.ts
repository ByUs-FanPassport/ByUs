const LIVE_PATH = /^\/live\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_LIVE_SLUGS = new Set(["calendar"]);
const AUTH_INTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const LOCAL_ORIGIN = "https://byus.local";

/**
 * Accepts only a canonical LIVE detail route that can safely resume the
 * reservation flow. Other internal paths are intentionally rejected so a
 * verification or issuance route cannot redirect back into itself.
 */
export function sanitizeLiveReturnTo(value: string | null | undefined): string | null {
  if (
    !value
    || value.length > 256
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || CONTROL_CHARACTER.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, LOCAL_ORIGIN);
    if (
      parsed.origin !== LOCAL_ORIGIN
      || parsed.username
      || parsed.password
      || parsed.hash
      || !LIVE_PATH.test(parsed.pathname)
      || parsed.pathname.length > 86
      || RESERVED_LIVE_SLUGS.has(parsed.pathname.slice("/live/".length))
    ) {
      return null;
    }

    const keys = [...parsed.searchParams.keys()];
    if (keys.some((key) => key !== "locale" && key !== "authIntent")) return null;

    const locales = parsed.searchParams.getAll("locale");
    if (locales.length !== 1 || (locales[0] !== "ko" && locales[0] !== "en")) return null;

    const authIntents = parsed.searchParams.getAll("authIntent");
    if (authIntents.length > 1 || (authIntents[0] && !AUTH_INTENT_ID.test(authIntents[0]))) return null;

    const query = new URLSearchParams({ locale: locales[0] });
    if (authIntents[0]) query.set("authIntent", authIntents[0].toLowerCase());
    return `${parsed.pathname}?${query.toString()}`;
  } catch {
    return null;
  }
}

export function appendLiveReturnTo(path: string, returnTo: string | null | undefined): string {
  const safeReturnTo = sanitizeLiveReturnTo(returnTo);
  if (!safeReturnTo) return path;

  const parsed = new URL(path, LOCAL_ORIGIN);
  parsed.searchParams.set("returnTo", safeReturnTo);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
