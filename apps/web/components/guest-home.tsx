"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { ArrowRight, Book, CalendarHeart, ChevronRight, GoogleMark, Menu } from "./icons";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import { AuthIntentLink } from "./auth-intent-link";
import { FanAppFrame } from "./fan-shell/fan-app-shell";
import { LiveHeroCarousel } from "./live-hero-carousel";
import styles from "./guest-home.module.css";

const socialLabel = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" } as const;
const fanCountFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const copy = {
  ko: { skip: "본문으로 바로가기", language: "언어 선택, 현재 한국어", panelClose: "로그인 및 Passport 영역 접기", panelOpen: "로그인 및 Passport 영역 펼치기", liveHeading: "ByUs. Your Bias.", liveSub: "오늘, 최애를 만나는 시간", allLive: "전체 라이브", noneStatus: "공개된 LIVE 없음", noneTitle: "새로운 LIVE를 준비하고 있어요.", reserve: "라이브 예약하기", details: "LIVE 상세보기", context: "로그인 및 Fan Passport 시작", google: "Google로 계속하기", passportIssue: "Fan Passport 발급받기", favorites: "당신의 최애", favoritesSub: "좋아하는 최애를 만나보세요.", all: "전체 보기", celebrityList: "셀럽 목록", detail: "상세 보기", social: "공식 채널", liveNow: "LIVE 진행중", liveUpcoming: "LIVE 예정", noCelebrities: "현재 공개된 셀럽이 없습니다.", upcoming: "다가오는 LIVE", upcomingSub: "미리 예약하고 알림을 받아보세요.", noLive: "현재 공개된 LIVE가 없습니다.", guestPanel: "로그인 전 팬 활동", soon: "곧 만날 최애", booked: "예약한 LIVE를 확인해보세요.", loginHint: "로그인하고 예약한 최애의 LIVE를 확인해 보세요.", passportHeading: "최애의 Fan Passport", passportSub: "팬이 된 모든 순간을 Passport에 기록하세요.", passportEmpty: "아직 발급된 Passport와 Stamp가 없어요.", passportHelp: "최애와 함께한 첫 순간부터 기록해 보세요." },
  en: { skip: "Skip to main content", language: "Choose language, currently English", panelClose: "Collapse sign-in and Passport panel", panelOpen: "Expand sign-in and Passport panel", liveHeading: "ByUs. Your Bias.", liveSub: "Your next moment with your favorite", allLive: "All LIVE events", noneStatus: "No published LIVE", noneTitle: "A new LIVE is in preparation.", reserve: "Reserve LIVE", details: "View LIVE details", context: "Sign in and start Fan Passport", google: "Continue with Google", passportIssue: "Get Fan Passport", favorites: "Your favorites", favoritesSub: "Meet the celebrities you love.", all: "View all", celebrityList: "Celebrity list", detail: "details", social: "official channel", liveNow: "LIVE NOW", liveUpcoming: "UPCOMING LIVE", noCelebrities: "No celebrities are published right now.", upcoming: "Upcoming LIVE", upcomingSub: "Reserve early and receive a notification.", noLive: "No LIVE event is published right now.", guestPanel: "Signed-out fan activities", soon: "Meet your favorite soon", booked: "Check your reserved LIVE events.", loginHint: "Sign in to see the LIVE events you reserved.", passportHeading: "Your favorite's Fan Passport", passportSub: "Keep every fan moment in your Passport.", passportEmpty: "You don't have a Passport or Stamp yet.", passportHelp: "Start recording moments with your favorite." },
} as const;

export function formatKoreanLiveDate(value: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid LIVE timestamp");
  const kst = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${period} ${displayHour}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function formatLiveDate(value: string, locale: ContentLocale) {
  if (locale === "ko") return formatKoreanLiveDate(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function formatFanCount(value: number) {
  return `${fanCountFormatter.format(value)} Fans`;
}

export function GuestHome({ celebrities, celebrityLives = [], featuredLives, locale }: { celebrities: readonly PublishedCelebrity[]; celebrityLives?: readonly PublishedCelebrityLive[]; featuredLives: readonly LiveEventResponse[]; locale: ContentLocale }) {
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const [panelOpen, setPanelOpen] = useState(true);
  const liveByCelebrity = new Map(celebrityLives.map((live) => [live.celebritySlug, live]));

  return (
    <FanAppFrame
      locale={locale}
      actions={<button className={styles.panelToggle} type="button" aria-label={panelOpen ? t.panelClose : t.panelOpen} aria-expanded={panelOpen} aria-controls="guest-context-panel" onClick={() => setPanelOpen((value) => !value)}><Menu /></button>}
    >
    <div className={styles.page} data-fan-pulse-home data-candidate="03">
      <a className={styles.skipLink} href="#main-content">{t.skip}</a>

      <div className={`${styles.shell} ${panelOpen ? styles.panelOpen : styles.panelClosed}`}>
        <main id="main-content" className={styles.main}>
          <section className={styles.heroSection} aria-labelledby="live-heading">
            <div className={styles.sectionHeadingRow}>
              <div className={styles.sectionIntro}><h1 id="live-heading">{t.liveHeading}</h1><p>{t.liveSub}</p></div>
              <Link className={styles.textLink} href={`/live${localeQuery}` as Route}>{t.allLive} <ChevronRight /></Link>
            </div>
            <LiveHeroCarousel featuredLives={featuredLives} locale={locale} />
          </section>

          <section className={styles.mobileContextActions} aria-label={t.context}>
            <Link className={styles.googleAction} data-service-accent="spectrum-outline" href={`/login${localeQuery}`}><GoogleMark /><span>{t.google}</span></Link>
            <AuthIntentLink className={styles.passportAction} locale={locale} input={{ sourcePath: "/passports", sourceQuery: localeQuery, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><Book /><span>{t.passportIssue}</span><ArrowRight /></AuthIntentLink>
          </section>

          <section id="celebrities" className={`${styles.contentSection} ${styles.favoriteSection}`} aria-labelledby="celebrities-heading">
            <div className={styles.sectionHeadingRow}><div className={styles.sectionIntro}><h2 id="celebrities-heading">{t.favorites}</h2><p>{t.favoritesSub}</p></div><Link className={styles.textLink} href={`/celebrities${localeQuery}`}>{t.all} <ChevronRight /></Link></div>
            <div className={styles.celebrityRail} aria-label={t.celebrityList}>
              {celebrities.map((celebrity) => {
                const celebrityLive = liveByCelebrity.get(celebrity.slug);
                const isLiveNow = celebrityLive?.effectiveStatus === "live";
                return (
                <article className={styles.celebrityCard} key={celebrity.slug}>
                  <Link className={styles.celebrityMediaBox} href={`/c/${celebrity.slug}${localeQuery}` as Route} aria-label={`${celebrity.name} ${t.detail}`}>
                    <Image src={celebrity.image.url} alt={celebrity.image.alt} width={420} height={420} style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
                  </Link>
                  <div className={styles.celebrityInfo}>
                    <div className={styles.celebrityMetaRow}>
                      <h3>{celebrity.name}</h3>
                      {celebrityLive ? <p className={styles.celebrityLiveStatus} data-live-state={celebrityLive.effectiveStatus}><span className={`${styles.liveDot} ${isLiveNow ? styles.liveDotActive : ""}`} aria-hidden="true" />{isLiveNow ? t.liveNow : t.liveUpcoming}</p> : null}
                    </div>
                    <div className={styles.celebrityMetaRow}>
                      <p className={styles.fanCount}>{formatFanCount(celebrity.fanCount)}</p>
                      <div className={styles.socialLinks} role="group" aria-label={`${celebrity.name} ${locale === "ko" ? "소셜 채널" : "social channels"}`}>
                        {celebrity.socialLinks.map((social) => <a className={styles.socialLink} href={social.url} target="_blank" rel="noreferrer" aria-label={`${celebrity.name} ${socialLabel[social.platform]} ${t.social}`} data-social-icon-only="true" key={social.platform}><Image src={`/images/guest-home/${social.platform}.svg`} alt="" width={16} height={16} aria-hidden="true" /></a>)}
                      </div>
                    </div>
                  </div>
                </article>
              )})}
              {celebrities.length === 0 ? <p role="status">{t.noCelebrities}</p> : null}
            </div>
          </section>

          <section id="upcoming" className={styles.contentSection} aria-labelledby="upcoming-heading">
            <div className={styles.sectionHeadingRow}><div className={styles.sectionIntro}><h2 id="upcoming-heading">{t.upcoming}</h2><p>{t.upcomingSub}</p></div></div>
            <div className={styles.liveList}>
              {featuredLives.length > 0 ? featuredLives.map((featuredLive) => {
                const statusLabel = featuredLive.live.effectiveStatus === "live" ? "LIVE" : "UPCOMING";
                return (
                  <article className={styles.liveRow} key={featuredLive.live.id}>
                    <Image className={styles.liveAvatar} src={featuredLive.live.celebrity.image} alt={`${featuredLive.live.celebrity.name} ${locale === "ko" ? "프로필" : "profile"}`} width={64} height={64} />
                    <div className={styles.liveDetails}><span>{featuredLive.live.celebrity.name}</span><h3>{featuredLive.live.title}</h3><p>{formatLiveDate(featuredLive.live.startsAt, locale)}</p></div>
                    <div className={styles.liveMeta}><span>{statusLabel}</span></div>
                    <Link className={styles.rowAction} href={`/live/${featuredLive.live.slug}${localeQuery}` as Route} aria-label={`${featuredLive.live.title} ${t.detail}`}><ChevronRight /></Link>
                  </article>
                );
              }) : <p>{t.noLive}</p>}
            </div>
          </section>
        </main>

        {panelOpen && <aside id="guest-context-panel" className={styles.contextPanel} aria-label={t.guestPanel}>
          <section className={`${styles.guestCard} ${styles.favoriteReferenceCard}`} aria-labelledby="favorite-live-heading">
            <div className={styles.favoriteReferenceContent}><h2 id="favorite-live-heading">{t.soon}</h2><p>{t.booked}</p><CalendarHeart className={styles.emptyIcon} /><p className={styles.loginHint}>{t.loginHint}</p><Link className={styles.googleButton} data-service-accent="spectrum-outline" href={`/login${localeQuery}`}><GoogleMark /><span>{t.google}</span></Link></div>
          </section>
          <section id="passport" className={`${styles.guestCard} ${styles.passportReferenceCard}`} aria-labelledby="passport-heading">
            <div className={styles.passportHeader}><h2 id="passport-heading">{t.passportHeading}</h2><p>{t.passportSub}</p></div>
            <div className={styles.passportAsset}><Image src="/images/guest-home/passport-open-blank-9-transparent.png" alt={locale === "ko" ? "빈 Stamp 원 9개가 있는 펼쳐진 Fan Passport" : "Opened Fan Passport with nine empty Stamp circles"} width={1536} height={1024} /></div>
            <div className={styles.passportFooter}><div><strong>{t.passportEmpty}</strong><p>{t.passportHelp}</p></div><AuthIntentLink locale={locale} input={{ sourcePath: "/passports", sourceQuery: localeQuery, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><span>{t.passportIssue}</span><ArrowRight /></AuthIntentLink></div>
          </section>
        </aside>}
      </div>

    </div>
    </FanAppFrame>
  );
}
