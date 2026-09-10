import type { Route } from "next";
import Link from "next/link";
import type { FanLocale } from "./fan-app-shell";
import styles from "./fan-language-switch.module.css";

export function FanLanguageSwitch({
  locale,
  href,
  ariaLabel,
}: {
  locale: FanLocale;
  href: Route;
  ariaLabel?: string;
}) {
  return (
    <Link
      className={styles.language}
      data-fan-language-action
      href={href}
      hrefLang={locale === "ko" ? "en" : "ko"}
      aria-label={ariaLabel ?? (locale === "ko" ? "언어 선택, 현재 한국어" : "Choose language, currently English")}
    >
      {locale === "ko" ? <strong>KO</strong> : <span>KO</span>}
      <span aria-hidden="true">/</span>
      {locale === "en" ? <strong>EN</strong> : <span>EN</span>}
    </Link>
  );
}
