export type AppLocale = "ko" | "en";

/** Local navigation only; nested auth return paths retain their intent and anchor. */
export function withLocalePath(path: string, locale: AppLocale, depth = 0): string {
  const fallback = `/?locale=${locale}`;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) return fallback;
  try {
    const origin = "https://byus.local";
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password) return fallback;
    const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
    url.searchParams.set(isAdmin ? "lang" : "locale", locale);
    const returnTo = url.searchParams.get("returnTo");
    if (returnTo !== null) {
      url.searchParams.set("returnTo", depth < 4 ? withLocalePath(returnTo, locale, depth + 1) : fallback);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function requestLocale(pathname: string, requested: string | null, callbackCookie?: string | null): AppLocale {
  const selected = requested ?? (pathname === "/settings/kakao/callback" ? callbackCookie : null);
  return selected === "en" ? "en" : "ko";
}
