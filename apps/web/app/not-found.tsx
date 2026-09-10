"use client";

import Link from "next/link";
import { useAppLocale } from "../components/locale-provider";
import styles from "../components/public-content-state.module.css";

export default function NotFound() {
  const { locale } = useAppLocale();
  return <main className={styles.page} lang={locale}>
    <div className={styles.state}>
      <span className={styles.wordmark}>ByUs</span>
      <h1>{locale === "en" ? "We couldn't find this page." : "페이지를 찾을 수 없어요."}</h1>
      <p>{locale === "en" ? "Check the address or return to the home page." : "주소를 확인하거나 홈으로 이동해 주세요."}</p>
      <div className={styles.actions}><Link href={`/?locale=${locale}`}>{locale === "en" ? "Go home" : "홈으로"}</Link></div>
    </div>
  </main>;
}
