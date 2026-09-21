"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { parseAppLocale, type AppLocale } from "../i18n/locales";

const LocaleContext = createContext<{ locale: AppLocale; setLocale: (locale: AppLocale) => void }>({ locale: "ko", setLocale: () => {} });

export function LocaleProvider({ initialLocale, children }: { initialLocale: AppLocale; children: ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useAppLocale() {
  return useContext(LocaleContext);
}

/** Page URLs can omit locale; explicit legacy links still select a language. */
export function usePageLocale(): AppLocale {
  const requested = useSearchParams().getAll("locale");
  const { locale } = useAppLocale();
  return requested.length === 1 ? parseAppLocale(requested[0], locale) : locale;
}
