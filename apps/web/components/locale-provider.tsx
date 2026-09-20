"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { AppLocale } from "./locale-path";

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
  const requested = useSearchParams().get("locale");
  const { locale } = useAppLocale();
  return requested === "ko" || requested === "en" ? requested : locale;
}
