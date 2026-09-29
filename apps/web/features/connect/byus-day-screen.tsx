"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import styles from "./byus-day-screen.module.css";

const copy = {
  ko: {
    back: "링크 모음", language: "언어 선택", main: "포스터 바로가기",
    date: "10월 15일(목) · 19:00–21:00",
    terms: "무료 · 주최자 승인제", rsvp: "참가 신청", newTab: "새 창에서 열기",
    registration: "BYUS DAY 참가 신청",
    poster: "BYUS DAY 행사 포스터. 2026년 10월 15일, 호텔 엘리에나 1층 카페 ByusSpace. 19시부터 21시까지 오프닝, ByUs 발표, 파트너 세션, ByUs Space Vision이 진행됩니다. 21시 이후에도 자유롭게 네트워킹을 이어갈 수 있습니다. 참가비는 무료이며 주최자 승인이 필요합니다.",
  },
  en: {
    back: "All links", language: "Choose language", main: "Skip to poster",
    date: "Thu, Oct 15 · 19:00–21:00 KST",
    terms: "Free · host approval required", rsvp: "RSVP", newTab: "opens in a new tab",
    registration: "BYUS DAY registration",
    poster: "BYUS DAY event poster. October 15, 2026 at ByusSpace, Hotel Eliena 1F Café. The official program runs from 19:00 to 21:00 KST: Opening, ByUs Big Announcement, Partner Session, and ByUs Space Vision. You are welcome to stay for open networking after 21:00. Admission is free and subject to host approval.",
  },
} as const;

export function ByusDayScreen() {
  const { locale: appLocale } = useAppLocale();
  const locale = appLocale === "ko" ? "ko" : "en";
  const t = copy[locale];

  return <div className={styles.page} lang={locale}>
    <a className={styles.skipLink} href="#byus-day-poster">{t.main}</a>
    <header className={styles.header}>
      <Link href={`/connect?locale=${locale}#links`} className={styles.back}><ArrowLeft size={18} aria-hidden="true" />{t.back}</Link>
      <span className={styles.wordmark} aria-hidden="true">BYUS DAY</span>
      <nav className={styles.languages} aria-label={t.language}>
        <Link href="/connect/byus-day?locale=ko" replace aria-current={locale === "ko" ? "true" : undefined} aria-label="한국어" lang="ko">KO</Link>
        <Link href="/connect/byus-day?locale=en" replace aria-current={locale === "en" ? "true" : undefined} aria-label="English" lang="en">EN</Link>
      </nav>
    </header>
    <main id="byus-day-poster" className={styles.canvas}>
      <h1 className={styles.srOnly}>BYUS DAY</h1>
      <Image className={styles.poster} src={`/images/connect/byus-day/poster-${locale}.webp`}
        width={1024} height={1536} alt={t.poster} unoptimized loading="eager" fetchPriority="high" />
    </main>
    <footer className={styles.footer} aria-label={t.registration}>
      <div className={styles.footerContent}>
        <div className={styles.details}>
          <p><time dateTime="2026-10-15T19:00:00+09:00">{t.date}</time></p>
          <p>ByusSpace <span aria-hidden="true">·</span> {t.terms}</p>
        </div>
        <a className={styles.rsvp} href="https://luma.com/hg1qdkvn" target="_blank" rel="noopener noreferrer">
          <span>{t.rsvp}<span className={styles.srOnly}> ({t.newTab})</span></span><ArrowUpRight size={22} aria-hidden="true" />
        </a>
      </div>
    </footer>
  </div>;
}
