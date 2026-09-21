"use client";

import { messages as localizedMessages } from "@/i18n/catalogs/app__not-found";
import { translate } from "@/i18n/messages";
import Link from "next/link";
import { useAppLocale } from "../components/locale-provider";
import styles from "../components/public-content-state.module.css";

export default function NotFound() {
  const { locale } = useAppLocale();
  return <main className={styles.page} lang={locale}>
    <div className={styles.state}>
      <span className={styles.wordmark}>ByUs</span>
      <h1>{locale === "ko" ? "페이지를 찾을 수 없어요." : translate(locale, localizedMessages.m1e9d04c47536, "We couldn't find this page.")}</h1>
      <p>{locale === "ko" ? "주소를 확인하거나 홈으로 이동해 주세요." : translate(locale, localizedMessages.m585d6e37ac74, "Check the address or return to the home page.")}</p>
      <div className={styles.actions}><Link href={`/?locale=${locale}`}>{locale === "ko" ? "홈으로" : translate(locale, localizedMessages.m8908f60f4cc3, "Go home")}</Link></div>
    </div>
  </main>;
}
