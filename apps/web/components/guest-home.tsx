"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Bell, Book, CalendarHeart, ChevronRight, Clock, GoogleMark, Home, Languages, Menu, Play, Radio, Users } from "./icons";
import styles from "./guest-home.module.css";

const celebrities = [
  { name: "KARA", slug: "kara", image: "/images/guest-home/kara-card.jpg", position: "center 46%" },
  { name: "Elina", slug: "elina", image: "/images/guest-home/elina-card.jpg", position: "center 36%" },
  { name: "Changha", slug: "changha", image: "/images/guest-home/changha-card.jpg", position: "center 32%" },
] as const;

const socials = [
  { id: "youtube", name: "YouTube", icon: "/images/guest-home/youtube.svg" },
  { id: "tiktok", name: "TikTok", icon: "/images/guest-home/tiktok.svg" },
  { id: "instagram", name: "Instagram", icon: "/images/guest-home/instagram.svg" },
] as const;

const upcoming = [
  { celebrity: "KARA", slug: "kara-nualeaf", image: "/images/guest-home/kara-card.jpg", title: "KARA × NUALEAF LIVE", date: "7월 24일 오후 8:00", reservations: "12,430명" },
  { celebrity: "SS501", slug: "ss501-summer-special", image: "/images/guest-home/ss501.jpg", title: "SUMMER SPECIAL LIVE", date: "7월 25일 오후 7:00", reservations: "8,210명" },
  { celebrity: "Elina", slug: "elina-beauty-talk", image: "/images/guest-home/elina-card.jpg", title: "BEAUTY TALK LIVE", date: "7월 27일 오후 8:00", reservations: "3,480명" },
] as const;

const authHref = "/login?returnTo=%2Flive%2Fkara-nualeaf&intent=reserve";

export function GuestHome() {
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <div className={styles.page} data-fan-pulse-home data-candidate="03">
      <a className={styles.skipLink} href="#main-content">본문으로 바로가기</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="ByUs 홈">
            <Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={80} height={30} priority />
          </Link>
          <nav className={styles.desktopNav} aria-label="주요 메뉴">
            <a className={styles.activeNav} href="#main-content" aria-current="page">HOME</a>
            <a href="#upcoming">LIVE</a>
            <a href="#celebrities">최애</a>
            <a href="#passport">MY</a>
          </nav>
          <div className={styles.headerActions}>
            <button className={styles.languageButton} type="button" aria-label="언어 선택, 현재 한국어"><Languages /></button>
            <button className={styles.panelToggle} type="button" aria-label={panelOpen ? "로그인 및 Passport 영역 접기" : "로그인 및 Passport 영역 펼치기"} aria-expanded={panelOpen} aria-controls="guest-context-panel" onClick={() => setPanelOpen((value) => !value)}><Menu /></button>
          </div>
        </div>
      </header>

      <div className={`${styles.shell} ${panelOpen ? styles.panelOpen : styles.panelClosed}`}>
        <main id="main-content" className={styles.main}>
          <section className={styles.heroSection} aria-labelledby="live-heading">
            <div className={styles.sectionHeadingRow}>
              <div className={styles.sectionIntro}><h1 id="live-heading">ByUs. Your Bias.</h1><p>오늘, 최애를 만나는 시간</p></div>
              <a className={styles.textLink} href="#upcoming">전체 라이브 <ChevronRight /></a>
            </div>
            <article className={styles.heroCard}>
              <Image src="/images/guest-home/kara-hero.png" alt="오렌지색 배경 앞 검정 의상을 입은 KARA 멤버들" fill sizes="(min-width: 1024px) 66vw, 100vw" priority />
              <div className={styles.heroOverlay} aria-hidden="true" />
              <div className={styles.heroContent}>
                <div className={styles.statusRail}><p className={styles.liveStatus}><Radio /> UPCOMING</p><p className={styles.heroDate}>7월 24일 오후 8:00</p></div>
                <h2>KARA × NUALEAF</h2>
                <p className={styles.heroCountdown} aria-label="남은 시간 6일 22시간 41분 23초"><Clock /> D-06 <span aria-hidden="true">·</span> 22:41:23</p>
                <a className={styles.primaryButton} href={authHref}><span><Play />라이브 예약하기</span><ArrowRight /></a>
              </div>
            </article>
          </section>

          <section className={styles.mobileContextActions} aria-label="로그인 및 Fan Passport 시작">
            <a className={styles.googleAction} data-service-accent="spectrum-outline" href="/login"><GoogleMark /><span>Google로 계속하기</span></a>
            <a className={styles.passportAction} data-service-accent="spectrum-outline" href="/login?returnTo=%2Fpassports"><Book /><span>Fan Passport 발급받기</span><ArrowRight /></a>
          </section>

          <section id="celebrities" className={`${styles.contentSection} ${styles.favoriteSection}`} aria-labelledby="celebrities-heading">
            <div className={styles.sectionHeadingRow}><div className={styles.sectionIntro}><h2 id="celebrities-heading">당신의 최애</h2><p>좋아하는 최애를 만나보세요.</p></div><a className={styles.textLink} href="/celebrities">전체 보기 <ChevronRight /></a></div>
            <div className={styles.celebrityRail} aria-label="셀럽 목록">
              {celebrities.map((celebrity) => (
                <article className={styles.celebrityCard} key={celebrity.slug}>
                  <a className={styles.celebrityMediaBox} href={`/c/${celebrity.slug}`} aria-label={`${celebrity.name} 상세 보기`}>
                    <Image src={celebrity.image} alt={`${celebrity.name} 프로필`} width={420} height={420} style={{ objectPosition: celebrity.position }} />
                  </a>
                  <div className={styles.celebrityInfo}>
                    <h3>{celebrity.name}</h3>
                    <div className={styles.socialLinks} aria-label={`${celebrity.name} 소셜 채널`}>
                      {socials.map((social) => <a className={styles.socialLink} href={`/login?returnTo=${encodeURIComponent(`/c/${celebrity.slug}`)}&intent=${social.id}`} aria-label={`${celebrity.name} ${social.name} 계정 연결`} data-social-icon-only="true" key={social.id}><Image src={social.icon} alt="" width={16} height={16} aria-hidden="true" /></a>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section id="upcoming" className={styles.contentSection} aria-labelledby="upcoming-heading">
            <div className={styles.sectionHeadingRow}><div className={styles.sectionIntro}><h2 id="upcoming-heading">다가오는 LIVE</h2><p>미리 예약하고 알림을 받아보세요.</p></div></div>
            <div className={styles.liveList}>
              {upcoming.map((live) => (
                <article className={styles.liveRow} key={live.slug}>
                  <Image className={styles.liveAvatar} src={live.image} alt={`${live.celebrity} 프로필`} width={64} height={64} />
                  <div className={styles.liveDetails}><span>{live.celebrity}</span><h3>{live.title}</h3><p>{live.date}</p></div>
                  <div className={styles.liveMeta}><span>예정</span><p>예약 {live.reservations}</p></div>
                  <a className={styles.rowAction} href={`/live/${live.slug}`} aria-label={`${live.title} 상세 보기`}><ChevronRight /></a>
                </article>
              ))}
            </div>
          </section>
        </main>

        {panelOpen && <aside id="guest-context-panel" className={styles.contextPanel} aria-label="로그인 전 팬 활동">
          <section className={`${styles.guestCard} ${styles.favoriteReferenceCard}`} aria-labelledby="favorite-live-heading">
            <div className={styles.favoriteReferenceContent}><h2 id="favorite-live-heading">곧 만날 최애</h2><p>예약한 LIVE를 확인해보세요.</p><CalendarHeart className={styles.emptyIcon} /><p className={styles.loginHint}>로그인하고 예약한 최애의 LIVE를 확인해 보세요.</p><a className={styles.googleButton} data-service-accent="spectrum-outline" href="/login"><GoogleMark /><span>Google로 계속하기</span></a></div>
          </section>
          <section id="passport" className={`${styles.guestCard} ${styles.passportReferenceCard}`} aria-labelledby="passport-heading">
            <div className={styles.passportHeader}><h2 id="passport-heading">최애의 Fan Passport</h2><p>팬이 된 모든 순간을 Passport에 기록하세요.</p></div>
            <div className={styles.passportAsset}><Image src="/images/guest-home/passport-open-empty.png" alt="모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport" width={1536} height={1024} /></div>
            <div className={styles.passportFooter}><div><strong>아직 발급된 Passport와 Stamp가 없어요.</strong><p>최애와 함께한 첫 순간부터 기록해 보세요.</p></div><a data-service-accent="spectrum-outline" href="/login?returnTo=%2Fpassports"><span>Fan Passport 발급받기</span><ArrowRight /></a></div>
          </section>
        </aside>}
      </div>

      <nav className={styles.bottomNav} aria-label="모바일 주요 메뉴">
        <a className={styles.bottomNavActive} href="#main-content" aria-current="page"><Home /><span>홈</span></a>
        <a href="/celebrities"><Users /><span>셀럽</span></a>
        <a href="/passports"><Book /><span>Passport</span></a>
        <a href="/notifications"><Bell /><span>알림</span></a>
      </nav>
    </div>
  );
}
