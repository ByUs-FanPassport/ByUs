"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect } from "react";
import { useAppLocale } from "./locale-provider";
import { requestLocale } from "./locale-path";

export function DocumentLocale() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const requestedLocale = searchParams.get(isAdminPage ? "lang" : "locale");
  const { setLocale } = useAppLocale();

  useLayoutEffect(() => {
    const callbackCookie = pathname === "/settings/kakao/callback"
      ? document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("byus_locale="))?.slice("byus_locale=".length)
      : null;
    const locale = requestLocale(pathname, requestedLocale, callbackCookie);
    document.documentElement.lang = locale;
    setLocale(locale);
  }, [pathname, requestedLocale, setLocale]);

  return null;
}
