"use client";

import { useSearchParams } from "next/navigation";
import { FanSiteFooter } from "./fan-site-footer";

export function PagesSiteFooter() {
  // Layouts persist during navigation; read the current URL here so the footer
  // follows language switches. Match the pages' fallback for repeated locales.
  const locales = useSearchParams().getAll("locale");
  const locale = locales.length === 1 && locales[0] === "en" ? "en" : "ko";
  return <FanSiteFooter locale={locale} />;
}
