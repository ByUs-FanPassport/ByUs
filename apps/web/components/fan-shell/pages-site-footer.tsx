"use client";

import { usePageLocale } from "@/components/locale-provider";

import { FanSiteFooter } from "./fan-site-footer";

export function PagesSiteFooter() {
  const locale = usePageLocale();
  return <FanSiteFooter locale={locale} />;
}
