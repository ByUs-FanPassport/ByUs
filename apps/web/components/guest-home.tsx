"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { z } from "zod";
import { ArrowRight, Book, CalendarHeart, ChevronLeft, ChevronRight, GoogleMark, Menu } from "./icons";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import { mySummarySchema, type MySummary } from "../features/my/domain/my-summary";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import { AuthIntentLink } from "./auth-intent-link";
import { FanAppFrame } from "./fan-shell/fan-app-shell";
import { LiveHeroCarousel } from "./live-hero-carousel";
import {
  ActivePreviewCoordinator,
  ActivePreviewVideo,
} from "./active-preview-video";
import { LiveStatusIndicator } from "./live-status-indicator";
import { formatFanCount } from "./fan-ui/fan-count";
import {
  PassportStampCanvas,
  type PassportStampRecord,
} from "../features/passport/ui/passport-stamp-artwork";
import { stampTypeSchema } from "../features/passport/domain/passport-read-model";
import styles from "./guest-home.module.css";

const socialLabel = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" } as const;

type HomePersonalizationState =
  | { status: "auth-loading" }
  | { status: "guest" }
  | { status: "authenticated-loading" }
  | { status: "authenticated-error" }
  | { status: "authenticated-ready"; summary: MySummary };

type PassportPreviewState =
  | { status: "loading" | "error"; stamps: readonly PassportStampRecord[]; totalCount: 0 }
  | { status: "ready"; stamps: readonly PassportStampRecord[]; totalCount: number };

const passportPreviewResponseSchema = z.object({
  passport: z.object({
    stamps: z.array(z.object({
      id: z.uuid(),
      type: stampTypeSchema,
      issuedAt: z.iso.datetime({ offset: true }),
    }).loose()),
    activities: z.array(z.object({
      stampId: z.uuid().nullable(),
      points: z.number().int(),
    }).loose()),
    stampSummary: z.object({ total: z.number().int().nonnegative() }).loose(),
  }).loose(),
}).loose();

const copy = {
  ko: { skip: "본문으로 바로가기", language: "언어 선택, 현재 한국어", panelClose: "팬 활동 영역 접기", panelOpen: "팬 활동 영역 펼치기", liveHeading: "ByUs. Your Bias.", liveSub: "오늘, 최애를 만나는 시간", allLive: "전체 라이브", noneStatus: "공개된 LIVE 없음", noneTitle: "새로운 LIVE를 준비하고 있어요.", reserve: "라이브 예약하기", details: "LIVE 상세보기", context: "로그인 및 Fan Passport 시작", google: "Google로 계속하기", passportIssue: "Fan Passport 발급받기", favorites: "당신의 최애", favoritesSub: "좋아하는 최애를 만나보세요.", all: "전체 보기", celebrityList: "셀럽 목록", detail: "상세 보기", social: "공식 채널", liveNow: "LIVE 진행중", liveUpcoming: "LIVE 예정", noCelebrities: "현재 공개된 셀럽이 없습니다.", upcoming: "다가오는 LIVE", upcomingSub: "미리 예약하고 알림을 받아보세요.", noLive: "현재 공개된 LIVE가 없습니다.", guestPanel: "로그인 전 팬 활동", soon: "곧 만날 최애", booked: "예약한 LIVE를 확인해보세요.", loginHint: "로그인하고 예약한 최애의 LIVE를 확인해 보세요.", passportHeading: "최애의 Fan Passport", passportSub: "팬이 된 모든 순간을 Passport에 기록하세요.", passportEmpty: "아직 발급된 Passport와 Stamp가 없어요.", passportHelp: "최애와 함께한 첫 순간부터 기록해 보세요.", signedInPanel: "나의 팬 활동", welcome: "반가워요.", myPassport: "내 Fan Passport", allPassports: "전체 Passport 보기", reservedLive: "예약한 LIVE", liveDetails: "LIVE 상세 보기", noPassport: "아직 발급된 Passport가 없어요.", passportPreview: "발급 전 Fan Passport 미리보기", passportPreviewHint: "팬 인증 완료 후 발급돼요.", findFavorite: "팬 인증할 최애 찾기", noReservation: "예약한 LIVE가 없어요.", browseLive: "LIVE 둘러보기", retryTitle: "팬 활동을 불러오지 못했어요.", retryHelp: "잠시 후 다시 시도해 주세요.", retry: "다시 시도", loading: "팬 활동을 불러오는 중이에요.", stamps: "Stamp", recentNine: "최근 9개 표시" },
  en: { skip: "Skip to main content", language: "Choose language, currently English", panelClose: "Collapse fan activity panel", panelOpen: "Expand fan activity panel", liveHeading: "ByUs. Your Bias.", liveSub: "Your next moment with your favorite", allLive: "All LIVE events", noneStatus: "No published LIVE", noneTitle: "A new LIVE is in preparation.", reserve: "Reserve LIVE", details: "View LIVE details", context: "Sign in and start Fan Passport", google: "Continue with Google", passportIssue: "Get Fan Passport", favorites: "Your favorites", favoritesSub: "Meet the celebrities you love.", all: "View all", celebrityList: "Celebrity list", detail: "details", social: "official channel", liveNow: "LIVE NOW", liveUpcoming: "UPCOMING LIVE", noCelebrities: "No celebrities are published right now.", upcoming: "Upcoming LIVE", upcomingSub: "Reserve early and receive a notification.", noLive: "No LIVE event is published right now.", guestPanel: "Signed-out fan activities", soon: "Meet your favorite soon", booked: "Check your reserved LIVE events.", loginHint: "Sign in to see the LIVE events you reserved.", passportHeading: "Your favorite's Fan Passport", passportSub: "Keep every fan moment in your Passport.", passportEmpty: "You don't have a Passport or Stamp yet.", passportHelp: "Start recording moments with your favorite.", signedInPanel: "My fan activity", welcome: "Welcome back.", myPassport: "My Fan Passport", allPassports: "View all Passports", reservedLive: "Reserved LIVE", liveDetails: "View LIVE details", noPassport: "You don't have a Passport yet.", passportPreview: "Fan Passport preview before issuance", passportPreviewHint: "Issued after fan verification.", findFavorite: "Find a favorite to verify", noReservation: "You don't have a reserved LIVE.", browseLive: "Browse LIVE", retryTitle: "We couldn't load your fan activity.", retryHelp: "Please try again in a moment.", retry: "Try again", loading: "Loading your fan activity.", stamps: "Stamps", recentNine: "Showing the latest 9" },
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

function useHomePersonalization(locale: ContentLocale) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<HomePersonalizationState>({ status: "auth-loading" });

  useEffect(() => {
    if (!ready) {
      setState({ status: "auth-loading" });
      return;
    }
    if (!authenticated) {
      setState({ status: "guest" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "authenticated-loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          setState({ status: "authenticated-error" });
          return;
        }
        const response = await fetch(`/api/me/summary?locale=${locale}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("summary unavailable");
        const body = await response.json() as unknown;
        const summary = mySummarySchema.parse((body as { summary?: unknown }).summary);
        setState({ status: "authenticated-ready", summary });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: "authenticated-error" });
      }
    })();
    return () => controller.abort();
  }, [authenticated, getAccessToken, locale, ready, retryKey]);

  return {
    state,
    retry: useCallback(() => setRetryKey((value) => value + 1), []),
  };
}

function usePassportPreview(passportId: string | null, locale: ContentLocale): PassportPreviewState {
  const { getAccessToken } = usePrivy();
  const [state, setState] = useState<PassportPreviewState>({ status: "loading", stamps: [], totalCount: 0 });

  useEffect(() => {
    const controller = new AbortController();
    if (!passportId) {
      setState({ status: "error", stamps: [], totalCount: 0 });
      return () => controller.abort();
    }

    setState({ status: "loading", stamps: [], totalCount: 0 });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("access token unavailable");
        const response = await fetch(`/api/passports/${encodeURIComponent(passportId)}?locale=${locale}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("passport preview unavailable");
        const parsed = passportPreviewResponseSchema.parse(await response.json());
        const pointsByStamp = new Map(parsed.passport.activities.flatMap((activity) => activity.stampId ? [[activity.stampId, activity.points] as const] : []));
        setState({
          status: "ready",
          stamps: parsed.passport.stamps.map((stamp) => ({ ...stamp, points: pointsByStamp.get(stamp.id) })),
          totalCount: parsed.passport.stampSummary.total,
        });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", stamps: [], totalCount: 0 });
      }
    })();
    return () => controller.abort();
  }, [getAccessToken, locale, passportId]);

  return state;
}

function PersonalizationLoading({ locale }: { locale: ContentLocale }) {
  return (
    <section className={styles.personalizationState} role="status" aria-live="polite">
      <span className={styles.stateSkeleton} aria-hidden="true" />
      <span>{copy[locale].loading}</span>
    </section>
  );
}

function AuthenticatedHomeSummary({ locale, summary, placement }: { locale: ContentLocale; summary: MySummary; placement: "desktop" | "mobile" }) {
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const passportCreators = summary.creators.filter((item) => item.passport !== null);
  const [activePassportIndex, setActivePassportIndex] = useState(0);
  const creator = passportCreators[activePassportIndex] ?? null;
  const passportPreview = usePassportPreview(creator?.passport?.id ?? null, locale);
  const reservation = summary.live.upcoming[0] ?? null;
  const headingId = `signed-in-home-heading-${placement}`;
  const passportCount = passportCreators.length;
  const selectPassport = (index: number) => setActivePassportIndex((index + passportCount) % passportCount);
  return (
    <section className={styles.signedInSummary} aria-labelledby={headingId}>
      <div className={styles.signedInGreeting}><h2 id={headingId}>{summary.profile.nickname ? `${summary.profile.nickname}${locale === "ko" ? "님, " : ", "}${t.welcome}` : t.welcome}</h2></div>
      <div className={styles.summarySection}>
        <div className={styles.summarySectionHeader}><span>{t.myPassport}</span>{passportCount > 1 ? <small>{passportCount}</small> : null}</div>
        {creator?.passport ? <><div className={styles.passportCarousel} role="group" aria-roledescription={locale === "ko" ? "Passport 슬라이드" : "Passport carousel"} aria-label={t.myPassport}>
          <Link className={styles.ownedPassportLink} href={`/passports/${creator.passport.id}${localeQuery}` as Route} aria-label={`${creator.celebrity.name} Fan Passport, ${creator.passport.tier}, ${creator.passport.score} Score`}>
            <span className={styles.ownedPassportArtwork}>
              <PassportStampCanvas
                celebrityName={creator.celebrity.name}
                level={creator.passport.tier}
                stamps={passportPreview.stamps}
                totalCount={passportPreview.totalCount}
                locale={locale}
                priority={placement === "desktop"}
              />
            </span>
            <h3>{creator.celebrity.name} Fan Passport</h3>
            <strong className={styles.passportValue}>{creator.passport.tier} · {creator.passport.score} Score</strong>
          </Link>
          {passportCount > 1 ? <div className={styles.passportControls} aria-label={locale === "ko" ? "Fan Passport 선택" : "Choose a Fan Passport"}>
            <button type="button" onClick={() => selectPassport(activePassportIndex - 1)} aria-label={locale === "ko" ? "이전 Fan Passport" : "Previous Fan Passport"}><ChevronLeft /></button>
            <div className={styles.passportDots}>{passportCreators.map((item, index) => <button key={item.passport?.id ?? item.celebrity.slug} type="button" aria-current={index === activePassportIndex ? "true" : undefined} aria-label={`${item.celebrity.name} Fan Passport`} onClick={() => selectPassport(index)}><span /></button>)}</div>
            <button type="button" onClick={() => selectPassport(activePassportIndex + 1)} aria-label={locale === "ko" ? "다음 Fan Passport" : "Next Fan Passport"}><ChevronRight /></button>
          </div> : null}
        </div><Link className={styles.summaryTextLink} href={`/passports${localeQuery}` as Route}>{t.allPassports}<ChevronRight /></Link></> : <div className={styles.summaryEmpty}><Image className={styles.emptyPassportPreview} src="/images/guest-home/passport-open-blank-9-transparent.png" alt={t.passportPreview} width={1536} height={1024}/><p>{t.noPassport}</p><span className={styles.emptyPassportHint}>{t.passportPreviewHint}</span><Link className={styles.summaryOutlineAction} href={`/celebrities${localeQuery}` as Route}>{t.findFavorite}<ArrowRight /></Link></div>}
      </div>
      <div className={styles.summarySection}>
        <div className={styles.summarySectionHeader}><span>{t.reservedLive}</span></div>
        {reservation ? <div className={styles.reservationSummary}><CalendarHeart aria-hidden="true"/><div><h3>{reservation.title}</h3><time dateTime={reservation.startsAt}>{formatLiveDate(reservation.startsAt, locale)}</time></div><Link className={styles.summaryOutlineAction} href={`/live/${reservation.slug}${localeQuery}` as Route}>{t.liveDetails}<ArrowRight /></Link></div> : <div className={styles.summaryEmpty}><CalendarHeart aria-hidden="true"/><p>{t.noReservation}</p><Link className={styles.summaryTextLink} href={`/live${localeQuery}` as Route}>{t.browseLive}<ChevronRight /></Link></div>}
      </div>
    </section>
  );
}

function PersonalizationError({ locale, retry }: { locale: ContentLocale; retry: () => void }) {
  const t = copy[locale];
  return (
    <section className={styles.personalizationState} role="alert">
      <strong>{t.retryTitle}</strong>
      <span>{t.retryHelp}</span>
      <button type="button" onClick={retry}>{t.retry}</button>
    </section>
  );
}

export function GuestHome({ celebrities, celebrityLives = [], featuredLives, locale }: { celebrities: readonly PublishedCelebrity[]; celebrityLives?: readonly PublishedCelebrityLive[]; featuredLives: readonly LiveEventResponse[]; locale: ContentLocale }) {
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const [panelOpen, setPanelOpen] = useState(true);
  const personalization = useHomePersonalization(locale);
  const liveByCelebrity = new Map(celebrityLives.map((live) => [live.celebritySlug, live]));
  const firstPreviewId =
    celebrities.find((celebrity) => liveByCelebrity.get(celebrity.slug)?.preview)
      ?.slug ?? null;

  return (
    <FanAppFrame
      locale={locale}
      mainId="main-content"
      actions={<button className={styles.panelToggle} type="button" aria-label={panelOpen ? t.panelClose : t.panelOpen} aria-expanded={panelOpen} aria-controls="guest-context-panel" onClick={() => setPanelOpen((value) => !value)}><Menu /></button>}
    >
    <div className={styles.page} data-fan-pulse-home data-candidate="03">
      <div className={`${styles.shell} ${panelOpen ? styles.panelOpen : styles.panelClosed}`}>
        <main id="main-content" className={styles.main}>
          <section className={styles.heroSection} aria-labelledby="live-heading">
            <div className={styles.sectionHeadingRow}>
              <div className={styles.sectionIntro}><h1 id="live-heading">{t.liveHeading}</h1><p>{t.liveSub}</p></div>
              <Link className={styles.textLink} href={`/live${localeQuery}` as Route}>{t.allLive} <ChevronRight /></Link>
            </div>
            <LiveHeroCarousel featuredLives={featuredLives} locale={locale} />
          </section>

          {personalization.state.status === "guest" ? (
            <section className={styles.mobileContextActions} aria-label={t.context}>
              <Link className={styles.googleAction} data-service-accent="spectrum-outline" href={`/login${localeQuery}`}><GoogleMark /><span>{t.google}</span></Link>
              <AuthIntentLink className={styles.passportAction} locale={locale} input={{ sourcePath: "/passports", sourceQuery: localeQuery, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><Book /><span>{t.passportIssue}</span><ArrowRight /></AuthIntentLink>
            </section>
          ) : (
            <div className={styles.mobilePersonalization}>
              {personalization.state.status === "authenticated-ready" ? <AuthenticatedHomeSummary locale={locale} summary={personalization.state.summary} placement="mobile" /> : null}
              {personalization.state.status === "authenticated-error" ? <PersonalizationError locale={locale} retry={personalization.retry} /> : null}
              {personalization.state.status === "auth-loading" || personalization.state.status === "authenticated-loading" ? <PersonalizationLoading locale={locale} /> : null}
            </div>
          )}

          <section id="celebrities" className={`${styles.contentSection} ${styles.favoriteSection}`} aria-labelledby="celebrities-heading">
            <div className={styles.sectionHeadingRow}><div className={styles.sectionIntro}><h2 id="celebrities-heading">{t.favorites}</h2><p>{t.favoritesSub}</p></div><Link className={styles.textLink} href={`/celebrities${localeQuery}`}>{t.all} <ChevronRight /></Link></div>
            <ActivePreviewCoordinator initialActiveId={firstPreviewId}>
            <div className={styles.celebrityRail} aria-label={t.celebrityList}>
              {celebrities.map((celebrity) => {
                const celebrityLive = liveByCelebrity.get(celebrity.slug);
                return (
                <article className={styles.celebrityCard} key={celebrity.slug}>
                  <Link className={styles.celebrityMediaBox} href={`/c/${celebrity.slug}${localeQuery}` as Route} aria-label={`${celebrity.name} ${t.detail}`}>
                    {celebrityLive?.preview ? (
                      <ActivePreviewVideo
                        id={celebrity.slug}
                        mode="card"
                        preview={{
                          videoUrl: celebrityLive.preview.square.videoUrl,
                          posterUrl: celebrityLive.preview.square.posterUrl,
                          durationMs: celebrityLive.preview.durationMs,
                        }}
                      />
                    ) : (
                      <Image src={celebrity.image.url} alt={celebrity.image.alt} width={420} height={420} style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
                    )}
                  </Link>
                  <div className={styles.celebrityInfo}>
                    <div className={styles.celebrityMetaRow}>
                      <h3>{celebrity.name}</h3>
                      {celebrityLive ? <LiveStatusIndicator status={celebrityLive.effectiveStatus} locale={locale} className={styles.celebrityLiveStatus} /> : null}
                    </div>
                    <div className={styles.celebrityMetaRow}>
                      <p className={styles.fanCount}>{formatFanCount(celebrity.fanCount)}</p>
                      <div className={styles.socialLinks} role="group" aria-label={`${celebrity.name} ${locale === "ko" ? "소셜 채널" : "social channels"}`}>
                        {celebrity.socialLinks.map((social) => <a className={styles.socialLink} href={social.url} target="_blank" rel="noreferrer" aria-label={`${celebrity.name} ${socialLabel[social.platform]} ${t.social}`} data-social-icon-only="true" data-platform={social.platform} key={social.platform}><Image src={`/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} aria-hidden="true" /></a>)}
                      </div>
                    </div>
                  </div>
                </article>
              )})}
              {celebrities.length === 0 ? <p role="status">{t.noCelebrities}</p> : null}
            </div>
            </ActivePreviewCoordinator>
          </section>

          <section id="upcoming" className={styles.contentSection} aria-labelledby="upcoming-heading">
            <div className={styles.sectionHeadingRow}><div className={styles.sectionIntro}><h2 id="upcoming-heading">{t.upcoming}</h2><p>{t.upcomingSub}</p></div></div>
            <div className={styles.liveList}>
              {featuredLives.length > 0 ? featuredLives.map((featuredLive) => {
                const statusLabel = featuredLive.live.effectiveStatus === "live" ? "LIVE" : "UPCOMING";
                return (
                  <article className={styles.liveRow} key={featuredLive.live.id}>
                    <Image className={styles.liveAvatar} src={featuredLive.live.celebrity.image} alt={`${featuredLive.live.celebrity.name} ${locale === "ko" ? "프로필" : "profile"}`} width={64} height={64} unoptimized={featuredLive.live.celebrity.image.startsWith("https://")} />
                    <div className={styles.liveDetails}><span>{featuredLive.live.celebrity.name}</span><h3>{featuredLive.live.title}</h3><p>{formatLiveDate(featuredLive.live.startsAt, locale)}</p></div>
                    <div className={styles.liveMeta}><span>{statusLabel}</span></div>
                    <Link className={styles.rowAction} href={`/live/${featuredLive.live.slug}${localeQuery}` as Route} aria-label={`${featuredLive.live.title} ${t.detail}`}><ChevronRight /></Link>
                  </article>
                );
              }) : <p>{t.noLive}</p>}
            </div>
          </section>
        </main>

        {panelOpen && <aside id="guest-context-panel" className={styles.contextPanel} aria-label={personalization.state.status === "guest" ? t.guestPanel : t.signedInPanel}>
          {personalization.state.status === "guest" ? <>
            <section className={`${styles.guestCard} ${styles.favoriteReferenceCard}`} aria-labelledby="favorite-live-heading">
              <div className={styles.favoriteReferenceContent}><h2 id="favorite-live-heading">{t.soon}</h2><p>{t.booked}</p><CalendarHeart className={styles.emptyIcon} /><p className={styles.loginHint}>{t.loginHint}</p><Link className={styles.googleButton} data-service-accent="spectrum-outline" href={`/login${localeQuery}`}><GoogleMark /><span>{t.google}</span></Link></div>
            </section>
            <section id="passport" className={`${styles.guestCard} ${styles.passportReferenceCard}`} aria-labelledby="passport-heading">
              <div className={styles.passportHeader}><h2 id="passport-heading">{t.passportHeading}</h2><p>{t.passportSub}</p></div>
              <div className={styles.passportAsset}><Image src="/images/guest-home/passport-open-blank-9-transparent.png" alt={locale === "ko" ? "빈 Stamp 원 9개가 있는 펼쳐진 Fan Passport" : "Opened Fan Passport with nine empty Stamp circles"} width={1536} height={1024} /></div>
              <div className={styles.passportFooter}><div><strong>{t.passportEmpty}</strong><p>{t.passportHelp}</p></div><AuthIntentLink locale={locale} input={{ sourcePath: "/passports", sourceQuery: localeQuery, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><span>{t.passportIssue}</span><ArrowRight /></AuthIntentLink></div>
            </section>
          </> : null}
          {personalization.state.status === "authenticated-ready" ? <AuthenticatedHomeSummary locale={locale} summary={personalization.state.summary} placement="desktop" /> : null}
          {personalization.state.status === "authenticated-error" ? <PersonalizationError locale={locale} retry={personalization.retry} /> : null}
          {personalization.state.status === "auth-loading" || personalization.state.status === "authenticated-loading" ? <PersonalizationLoading locale={locale} /> : null}
        </aside>}
      </div>

    </div>
    </FanAppFrame>
  );
}
