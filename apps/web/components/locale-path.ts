import { parseAppLocale, toContentLocale, type AppLocale } from "../i18n/locales";

export type { AppLocale } from "../i18n/locales";

/** Local navigation only; nested auth return paths retain their intent and anchor. */
export function withLocalePath(path: string, locale: AppLocale, depth = 0): string {
  const fallback = `/?locale=${locale}`;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) return fallback;
  try {
    const origin = "https://byus.local";
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password) return fallback;
    const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
    url.searchParams.set(isAdmin ? "lang" : "locale", isAdmin ? toContentLocale(locale) : locale);
    const returnTo = url.searchParams.get("returnTo");
    if (returnTo !== null) {
      url.searchParams.set("returnTo", depth < 4 ? withLocalePath(returnTo, locale, depth + 1) : fallback);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function isInstagramManagementPath(pathname: string): boolean {
  return /^\/(?:creator|connect)\/instagram(?:\/|$)/.test(pathname);
}

export function requestLocale(pathname: string, requested: string | null, callbackCookie?: string | null, acceptLanguage?: string | null, preference?: string | null): AppLocale {
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const parse = (value: unknown): AppLocale | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    const language = value.trim().replaceAll("_", "-").split("-")[0].toLowerCase();
    if (!["ko", "en", "ja", "zh", "es", "id", "vi", "th", "pt", "fr"].includes(language)) return null;
    const locale = parseAppLocale(value);
    return isAdmin && locale !== "ko" && locale !== "en" ? null : isInstagramManagementPath(pathname) ? toContentLocale(locale) : locale;
  };

  const explicit = parse(requested);
  if (explicit) return explicit;
  if (pathname === "/settings/kakao/callback") {
    const callback = parse(callbackCookie);
    if (callback) return callback;
  }
  const browserPreference = parse(preference);
  if (browserPreference) return browserPreference;

  const candidates = (acceptLanguage ?? "").split(",").flatMap((entry, index) => {
    const [tag, ...parameters] = entry.trim().split(";");
    const qualityParameters = parameters.map((parameter) => parameter.trim()).filter((parameter) => /^q(?:\s*=|$)/i.test(parameter));
    if (!tag || tag === "*" || qualityParameters.length > 1) return [];
    const quality = qualityParameters.length === 0 ? 1 : /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i.test(qualityParameters[0])
      ? Number(qualityParameters[0].slice(2)) : 0;
    const locale = quality > 0 ? parse(tag) : null;
    return locale ? [{ locale, quality, index }] : [];
  }).sort((a, b) => b.quality - a.quality || a.index - b.index);
  return candidates[0]?.locale ?? "en";
}
