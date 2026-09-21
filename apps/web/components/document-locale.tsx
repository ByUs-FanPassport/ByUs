"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect } from "react";
import { useAppLocale } from "./locale-provider";
import { isInstagramManagementPath, requestLocale } from "./locale-path";

export function DocumentLocale() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const { setLocale } = useAppLocale();

  useLayoutEffect(() => {
    const cookie = (name: string) => document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
    const synchronize = (requested: string | null, currentPath = pathname) => {
      const url = new URL(window.location.href);
      const admin = currentPath === "/admin" || currentPath.startsWith("/admin/");
      const preference = admin ? null : window.history.state?.byusLocale ?? cookie("byus_page_locale");
      const locale = requestLocale(currentPath, requested, cookie("byus_locale"), navigator.languages.length ? navigator.languages.join(",") : navigator.language, preference);
      document.documentElement.lang = locale;
      setLocale(locale);
      if (!admin) {
        if (!isInstagramManagementPath(currentPath)) document.cookie = `byus_page_locale=${locale}; Path=/; SameSite=Lax`;
        if (url.searchParams.has("locale")) {
          url.searchParams.delete("locale");
          // Let Next synchronize its URL too, including repeated same-page links.
          window.history.replaceState({ byusLocale: locale }, "", `${url.pathname}${url.search}${url.hash}`);
        } else if (window.history.state?.byusLocale !== locale) {
          // Record the language without changing this clean URL's router state.
          window.history.replaceState({ ...window.history.state, byusLocale: locale }, "");
        }
      }
    };
    synchronize(new URLSearchParams(query).get(isAdminPage ? "lang" : "locale"));
    const restore = () => {
      const url = new URL(window.location.href);
      const admin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
      synchronize(url.searchParams.get(admin ? "lang" : "locale"), url.pathname);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [pathname, query, isAdminPage, setLocale]);

  return null;
}
