"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronRight, LoaderCircle, Mail, Pause, Play, RotateCcw, VideoOff, X } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { BottomSheet } from "@/components/ui/overlay/accessible-overlay";
import { rememberOverlayTrigger } from "@/components/ui/overlay/focus-return";
import styles from "./connect-screen.module.css";

const seenKey = "byus:connect:intro-seen:v1";
const videoSrc = "/images/connect/intro.mp4";
const contacts = [
  { ko: "김보석", en: "Boseok Kim", handle: "pifbetter" },
  { ko: "김재영", en: "Jaeyoung Kim", handle: "ljyk11" },
  { ko: "김종호", en: "Delta Manager", handle: "managerdelta" },
] as const;
const copy = {
  ko: {
    skip: "건너뛰기", intro: "좋아한 순간이,\n나만의 기록으로.",
    title: "함께한 순간을 모으는\n팬 패스포트", description: "좋아하는 아티스트와의 순간을 기록하고,\n새로운 팬 이벤트에도 참여해 보세요.",
    website: "ByUs 둘러보기", websiteDetail: "팬 활동과 이벤트를 만나보세요",
    event: "BYUS DAY 참가 신청", eventDetail: "10.22(목) 18:30 · Dragon Hill Lodge",
    business: "비즈니스 연락", businessDetail: "이메일 · Telegram", replay: "소개 영상 다시보기",
    play: "소개 영상 재생", pause: "소개 영상 일시정지", loading: "영상을 불러오는 중…",
    failed: "영상을 재생하지 못했어요.", failedDetail: "건너뛰기를 눌러 ByUs 링크를 확인하세요.", retry: "다시 시도",
    videoLabel: "ByUs 소개: 팬 패스포트에 함께한 순간이 스탬프로 쌓입니다.",
    poster: "펼쳐진 팬 패스포트에 모인 활동 스탬프", contactTitle: "ByUs 팀에 연락하기", contactHint: "편한 채널로 연락해 주세요.",
    close: "연락처 닫기", email: "이메일", newTab: "새 창에서 열기", nav: "공식 채널", language: "언어 선택", main: "본문 바로가기",
  },
  en: {
    skip: "Skip", intro: "Your favorite moments.\nYour own story.",
    title: "A fan passport for\nyour favorite moments.", description: "Collect moments with your favorite artists\nand discover your next fan experience.",
    website: "Explore ByUs", websiteDetail: "Discover fan activities and events",
    event: "BYUS DAY · RSVP", eventDetail: "Oct 22, 18:30 · Dragon Hill Lodge",
    business: "Business contact", businessDetail: "Email · Telegram", replay: "Watch our story again",
    play: "Play our story", pause: "Pause our story", loading: "Loading our story…",
    failed: "The video couldn’t play.", failedDetail: "Select Skip to explore our links.", retry: "Try again",
    videoLabel: "Introducing ByUs: shared moments become stamps in a fan passport.",
    poster: "An open fan passport filled with activity stamps", contactTitle: "Meet the ByUs team", contactHint: "Reach us on your preferred channel.",
    close: "Close contacts", email: "Email", newTab: "opens in a new tab", nav: "Official channels", language: "Choose language", main: "Skip to content",
  },
} as const;

export function ConnectScreen() {
  const { locale: appLocale, setLocale } = useAppLocale();
  const locale = appLocale === "ko" ? "ko" : "en";
  const t = copy[locale];
  const [view, setView] = useState<"intro" | "links">("intro");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "playing" | "paused" | "error">("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [contactOpen, setContactOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const focusAfterChange = useRef(false);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(seenKey) === "true"; } catch { /* Storage is optional. */ }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (seen || window.location.hash === "#links" || reduceMotion || saveData) setView("links");
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || view !== "intro") return;
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    video.play().catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) setStatus(value => value === "error" ? value : "paused");
    });
    return () => { active = false; video.pause(); };
  }, [ready, view, attempt]);

  useEffect(() => {
    if (!ready || view !== "intro" || status !== "loading") return;
    const timeout = window.setTimeout(() => {
      if ((videoRef.current?.readyState ?? 0) < 3) setStatus("error");
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [ready, view, status, attempt]);

  useEffect(() => {
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  function showLinks() {
    videoRef.current?.pause();
    try { sessionStorage.setItem(seenKey, "true"); } catch { /* Links remain available without storage. */ }
    focusAfterChange.current = true;
    setView("links");
  }
  function replay() {
    setCurrentTime(0);
    setStatus("loading");
    setAttempt(value => value + 1);
    focusAfterChange.current = true;
    setView("intro");
  }
  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();
    else video.play().catch(() => setStatus("error"));
  }
  function changeLanguage(next: "ko" | "en") {
    setLocale(next);
    document.documentElement.lang = next;
    document.cookie = `byus_page_locale=${next}; Path=/; SameSite=Lax`;
    window.history.replaceState({ ...window.history.state, byusLocale: next }, "");
  }

  return <div className={`${styles.page} ${view === "intro" ? styles.immersive : ""}`} lang={locale}>
    <a className={styles.skipLink} href="#connect-main">{t.main}</a>
    <header className={styles.header}>
      <a href={`/?locale=${locale}`} aria-label="ByUs" className={styles.logo}>
        <Image src="/images/guest-home/byus-wordmark.svg" width={78} height={32} alt="ByUs" priority />
      </a>
      {view === "intro" ? <div className={styles.introActions}>
        {status !== "error" && <button type="button" className={styles.playback} onClick={togglePlayback}
          disabled={status === "loading"} aria-label={status === "playing" ? t.pause : t.play} title={status === "playing" ? t.pause : t.play}>
          {status === "playing" ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>}
        <button type="button" className={styles.skip} onClick={showLinks}>{t.skip}<ArrowRight size={16} aria-hidden="true" /></button>
      </div>
        : <div className={styles.languages} role="group" aria-label={t.language}>
          <button type="button" onClick={() => changeLanguage("ko")} aria-pressed={locale === "ko"} aria-label="한국어" lang="ko">KO</button>
          <button type="button" onClick={() => changeLanguage("en")} aria-pressed={locale === "en"} aria-label="English" lang="en">EN</button>
        </div>}
    </header>

    <main id="connect-main" data-outro={view === "intro" && currentTime >= 8 || undefined} className={`${styles.content} ${view === "intro" ? styles.intro : styles.hub}`}>
      <div className={styles.copy}>
        {view === "intro" && <p className={styles.eyebrow}>MOMENTS BECOME YOURS</p>}
        <h1 ref={headingRef} tabIndex={-1}>{view === "intro" ? t.intro : t.title}</h1>
        {view === "links" && <p className={styles.description}>{t.description}</p>}
      </div>

      {view === "intro" ? <>
        <div className={styles.film}>
          <video key={attempt} ref={videoRef} src={ready ? videoSrc : undefined} poster="/images/connect/intro-poster.webp"
            width={720} height={1280} muted playsInline preload="metadata" aria-label={t.videoLabel}
            onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
            onPlaying={() => setStatus("playing")} onPause={() => setStatus(value => value === "error" ? value : "paused")}
            onWaiting={() => setStatus("loading")} onError={() => setStatus("error")} onEnded={showLinks} />
          {status === "error" ? <div className={styles.videoNotice} role="status">
            <VideoOff size={32} aria-hidden="true" /><strong>{t.failed}</strong><p>{t.failedDetail}</p>
            <button type="button" onClick={replay} className={styles.retry}><RotateCcw size={16} aria-hidden="true" />{t.retry}</button>
          </div> : <>
            {status === "loading" && <div className={styles.loading} role="status"><LoaderCircle size={20} aria-hidden="true" />{t.loading}</div>}
          </>}
        </div>
      </> : <>
        <div className={styles.passport}>
          <Image src="/images/connect/passport-spread.webp" alt={t.poster} width={960} height={720} sizes="(min-width: 1000px) 580px, 390px" priority />
        </div>
        <nav className={styles.links} aria-label={t.nav}>
          <a className={`${styles.linkCard} ${styles.primary}`} href={`/?locale=${locale}`}>
            <span><strong>{t.website}</strong><small>{t.websiteDetail}</small></span><ArrowUpRight size={22} aria-hidden="true" />
          </a>
          <Link className={`${styles.linkCard} ${styles.eventCard}`} href={`/connect/byus-day?locale=${locale}`}>
            <span className={styles.eventDate} aria-hidden="true">OCT<b>22</b></span>
            <span><strong>{t.event}</strong><small>{t.eventDetail}</small></span><ChevronRight size={22} aria-hidden="true" />
          </Link>
          <a className={styles.linkCard} href="https://www.instagram.com/official_byus/" target="_blank" rel="noopener noreferrer">
            <span><strong>Instagram</strong><small>@official_byus</small><span className={styles.srOnly}> ({t.newTab})</span></span><ArrowUpRight size={22} aria-hidden="true" />
          </a>
          <button type="button" className={styles.linkCard} onClick={event => { rememberOverlayTrigger(event.currentTarget); setContactOpen(true); }} aria-haspopup="dialog" aria-expanded={contactOpen}>
            <span><strong>{t.business}</strong><small>{t.businessDetail}</small></span><ChevronRight size={22} aria-hidden="true" />
          </button>
        </nav>
        <button type="button" className={styles.replay} onClick={replay}><RotateCcw size={16} aria-hidden="true" />{t.replay}</button>
        <p className={styles.credit}>ByUs, by SallyLab</p>
      </>}
      <noscript><p><a href="/">ByUs</a> · <a href="https://www.instagram.com/official_byus/">Instagram</a> · <a href="mailto:biz@sallylab.io">biz@sallylab.io</a></p></noscript>
    </main>

    <BottomSheet open={contactOpen} onClose={() => setContactOpen(false)} labelledBy="connect-contact-title" initialFocusRef={closeRef} backdropClassName={styles.backdrop} contentClassName={styles.sheet}>
      <div lang={locale}>
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetHeader}><h2 id="connect-contact-title">{t.contactTitle}</h2><button ref={closeRef} type="button" onClick={() => setContactOpen(false)} aria-label={t.close}><X size={21} aria-hidden="true" /></button></div>
        <a className={styles.email} href="mailto:biz@sallylab.io"><Mail size={25} aria-hidden="true" /><span><small>{t.email}</small><strong>biz@sallylab.io</strong></span><ArrowUpRight size={20} aria-hidden="true" /></a>
        <p className={styles.contactLabel}>TELEGRAM</p>
        <ul className={styles.team}>{contacts.map(person => <li key={person.handle}>
          <a href={`https://t.me/${person.handle}`} target="_blank" rel="noopener noreferrer">
            <span className={styles.telegram}><Image src="/images/connect/telegram.svg" width={24} height={24} alt="" /></span>
            <span><strong>{person[locale]}</strong><small>@{person.handle}</small><span className={styles.srOnly}> ({t.newTab})</span></span><ArrowUpRight size={18} aria-hidden="true" />
          </a>
        </li>)}</ul>
        <p className={styles.contactHint}>{t.contactHint}</p>
      </div>
    </BottomSheet>
  </div>;
}
