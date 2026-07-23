"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect } from "react";

export function DocumentLocale() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const requestedLocale = searchParams.get(isAdminPage ? "lang" : "locale");
  const locale = requestedLocale === "en" ? "en" : "ko";

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
