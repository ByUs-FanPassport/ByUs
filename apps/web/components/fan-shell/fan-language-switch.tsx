"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { APP_LOCALES, APP_LOCALE_NATIVE_NAMES, LANGUAGE_SELECTOR_ARIA_LABELS, isAppLocale, type AppLocale } from "../../i18n/locales";
import { withLocalePath } from "../locale-path";
import styles from "./fan-language-switch.module.css";

export function FanLanguageSwitch({
  locale,
  href,
  ariaLabel,
}: {
  locale: AppLocale;
  href: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Legacy callers describe a binary KO/EN toggle, so the 11-language control owns its label.
  void ariaLabel;
  return (
    <select
      className={styles.language}
      data-fan-language-action
      disabled={!ready}
      value={locale}
      aria-label={LANGUAGE_SELECTOR_ARIA_LABELS[locale]}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (isAppLocale(next)) router.push(withLocalePath(href, next) as Route);
      }}
    >
      {APP_LOCALES.map((option) => <option key={option} value={option}>{APP_LOCALE_NATIVE_NAMES[option]}</option>)}
    </select>
  );
}
