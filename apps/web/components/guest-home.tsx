"use client";

import { CreatorFanLink } from "./fan-ui/creator-fan-link";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";

import { LiveTimeIndicator } from "@/features/live/ui/live-time-indicator";

import { CreatorPortrait } from "./fan-ui/creator-portrait";
import { CreatorRoleFilterControl, CreatorRolesText } from "./fan-ui/creator-roles";
import { availableCreatorRoles, matchesCreatorRole, type CreatorRoleFilter } from "@/features/creator/domain/creator-role";
import { HomeOwnerProvider, useHomeOwner } from "./fan-ui/home-owner-provider";

import Image from "next/image";
import { orderCreatorsForDiscovery } from "../server/content/creator-discovery";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Book, CalendarHeart, ChevronLeft, ChevronRight, GoogleMark } from "./icons";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import type { MySummary } from "../features/my/domain/my-summary";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import { AuthIntentLink } from "./auth-intent-link";
import { FanAppFrame } from "./fan-shell/fan-app-shell";
import { LiveHeroCarousel } from "./live-hero-carousel";
import {
  ActivePreviewCoordinator,
  ActivePreviewVideo,
} from "./active-preview-video";
import { formatFanCount } from "./fan-ui/fan-count";
import { type PassportStampRecord } from "../features/passport/ui/passport-stamp-artwork";
import { PassportIdentityArtwork } from "../features/passport/ui/passport-identity-artwork";
import { levelLabel, type PassportLevel } from "../features/passport/domain/passport-read-model";
import { FanSectionHeader } from "./fan-ui/fan-heading";
import { FanStageTooltip } from "../features/rewards/ui/fan-stage-tooltip";
import { fanStageLabel } from "../features/rewards/domain/fan-stage";
import styles from "./guest-home.module.css";
import { HomeEntryCards } from "./home-entry-cards/home-entry-cards";

const socialLabel = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", chzzk: "치지직" } as const;
const UPCOMING_LIVE_PAGE_SIZE = 3;

export type HomeContentErrors = { celebrities?: boolean; celebrityLives?: boolean; featuredLives?: boolean };

const copy = {
  ko: { skip: "본문으로 바로가기", language: "언어 선택, 현재 한국어", liveHeading: "ByUs. Your Bias.", liveSub: "오늘, 최애를 만나는 시간", allLive: "전체 라이브", noneStatus: "공개된 LIVE 없음", noneTitle: "새로운 LIVE를 준비하고 있어요.", reserve: "라이브 예약하기", details: "LIVE 상세보기", context: "로그인 및 Fan Passport 시작", google: "Google로 계속하기", passportIssue: "Fan Passport 발급받기", favorites: "당신의 최애", favoritesSub: "좋아하는 최애를 만나보세요.", all: "전체 보기", celebrityList: "셀럽 목록", detail: "상세 보기", social: "공식 채널", liveNow: "LIVE 진행중", liveUpcoming: "LIVE 예정", noCelebrities: "현재 공개된 셀럽이 없습니다.", myFavoritesGuest: "내 최애를 보려면 로그인해 주세요.", myFavoritesLoading: "보유한 Fan Passport를 확인하고 있어요.", myFavoritesError: "보유한 Fan Passport를 확인하지 못했어요.", myFavoritesEmpty: "아직 보유한 Fan Passport가 없어요.", myFavoritesUnavailable: "지금 공개된 내 최애가 없어요.", myFavoritesUnavailableHelp: "전체에서 다른 최애를 만나보세요.", myFavoritesHelp: "전체 최애를 둘러보고 Fan Passport를 만들어 보세요.", signIn: "로그인하기", upcoming: "다가오는 LIVE", upcomingSub: "미리 예약하고 알림을 받아보세요.", previousLivePage: "이전 LIVE 목록", nextLivePage: "다음 LIVE 목록", noLive: "현재 공개된 LIVE가 없습니다.", guestPanel: "로그인 전 팬 활동", soon: "곧 만날 최애", booked: "예약한 LIVE를 확인해보세요.", loginHint: "로그인하고 예약한 최애의 LIVE를 확인해 보세요.", passportHeading: "최애의 Fan Passport", passportSub: "팬이 된 모든 순간을 Passport에 기록하세요.", passportEmpty: "아직 발급된 Passport와 Stamp가 없어요.", passportHelp: "최애와 함께한 첫 순간부터 기록해 보세요.", signedInPanel: "나의 팬 활동", welcome: "반가워요.", myPassport: "내 패스포트", allPassports: "패스포트 전체 보기", reservedLive: "예약한 LIVE", liveDetails: "LIVE 상세 보기", noPassport: "아직 발급된 Passport가 없어요.", passportPreview: "발급 전 Fan Passport 미리보기", passportPreviewHint: "팬 인증 완료 후 발급돼요.", findFavorite: "팬 인증할 최애 찾기", noReservation: "예약한 LIVE가 없어요.", browseLive: "LIVE 둘러보기", retryTitle: "팬 활동을 불러오지 못했어요.", retryHelp: "잠시 후 다시 시도해 주세요.", retry: "다시 시도", loading: "팬 활동을 불러오는 중이에요.", stamps: "Stamp", recentNine: "최근 9개 표시" },
  en: { skip: "Skip to main content", language: "Choose language, currently English", liveHeading: "ByUs. Your Bias.", liveSub: "Your next moment with your favorite", allLive: "All LIVE events", noneStatus: "No published LIVE", noneTitle: "A new LIVE is in preparation.", reserve: "Reserve LIVE", details: "View LIVE details", context: "Sign in and start Fan Passport", google: "Continue with Google", passportIssue: "Get Fan Passport", favorites: "Your favorites", favoritesSub: "Meet the celebrities you love.", all: "View all", celebrityList: "Celebrity list", detail: "details", social: "official channel", liveNow: "LIVE NOW", liveUpcoming: "UPCOMING LIVE", noCelebrities: "No celebrities are published right now.", myFavoritesGuest: "Sign in to see your favorites.", myFavoritesLoading: "Checking the Fan Passports you own.", myFavoritesError: "We couldn't check your Fan Passports.", myFavoritesEmpty: "You don't own a Fan Passport yet.", myFavoritesUnavailable: "No profiles are currently available in your favorites.", myFavoritesUnavailableHelp: "Browse all profiles to meet other favorites.", myFavoritesHelp: "Browse all favorites and create a Fan Passport.", signIn: "Sign in", upcoming: "Upcoming LIVE", upcomingSub: "Reserve early and receive a notification.", previousLivePage: "Previous LIVE events", nextLivePage: "Next LIVE events", noLive: "No LIVE event is published right now.", guestPanel: "Signed-out fan activities", soon: "Meet your favorite soon", booked: "Check your reserved LIVE events.", loginHint: "Sign in to see the LIVE events you reserved.", passportHeading: "Your favorite's Fan Passport", passportSub: "Keep every fan moment in your Passport.", passportEmpty: "You don't have a Passport or Stamp yet.", passportHelp: "Start recording moments with your favorite.", signedInPanel: "My fan activity", welcome: "Welcome back.", myPassport: "My Fan Passport", allPassports: "View all Passports", reservedLive: "Reserved LIVE", liveDetails: "View LIVE details", noPassport: "You don't have a Passport yet.", passportPreview: "Fan Passport preview before issuance", passportPreviewHint: "Issued after fan verification.", findFavorite: "Find a favorite to verify", noReservation: "You don't have a reserved LIVE.", browseLive: "Browse LIVE", retryTitle: "We couldn't load your fan activity.", retryHelp: "Please try again in a moment.", retry: "Try again", loading: "Loading your fan activity.", stamps: "Stamps", recentNine: "Showing the latest 9" },
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

export function formatPassportTier(tier: PassportLevel, locale: ContentLocale) {
  return levelLabel(locale, tier);
}

function formatPassportTitle(name: string, locale: ContentLocale) {
  return locale === "ko" ? `${name} 패스포트` : `${name} Fan Passport`;
}

function formatPassportValue(tier: PassportLevel, score: number, locale: ContentLocale, stage?: NonNullable<MySummary["creators"][number]["passport"]>["stageProgress"]) {
  const tierName = stage ? fanStageLabel(locale, stage.current) : formatPassportTier(tier, locale);
  return locale === "ko"
    ? `${tierName} · ${score}점`
    : `${tierName} · ${score} Score`;
}

function PersonalizationLoading({ locale }: { locale: ContentLocale }) {
  return (
    <section className={`${styles.personalizationState} ${styles.personalizationLoading}`} role="status" aria-live="polite">
      <span className={styles.stateSkeleton} aria-hidden="true" />
      <span className={styles.stateSkeletonShort} aria-hidden="true" />
      <span>{copy[locale].loading}</span>
    </section>
  );
}

function AuthenticatedHomeSummary({ locale, summary, placement, featuredLives }: { locale: ContentLocale; summary: MySummary; placement: "desktop" | "mobile"; featuredLives: readonly LiveEventResponse[] }) {
  const owner = useHomeOwner();
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const passportCreators = summary.creators.filter((item) => item.passport !== null);
  const activePassportIndex = Math.max(0, passportCreators.findIndex((item) => item.passport?.id === owner.selectedPassportId));
  const creator = passportCreators[activePassportIndex] ?? null;
  const passportPreview = owner.passportPreview.status === "ready"
    ? { status: "ready" as const, ...owner.passportPreview.data }
    : { status: owner.passportPreview.status, stamps: [] as readonly PassportStampRecord[], totalCount: 0 };
  const reservation = summary.live.upcoming[0] ?? null;
  const reservationCreator = featuredLives.find(({ live }) => live.id === reservation?.id)?.live.celebrity;
  const headingId = `signed-in-home-heading-${placement}`;
  const passportCount = passportCreators.length;
  const selectPassport = (index: number) => {
    const selected = passportCreators[(index + passportCount) % passportCount]?.passport;
    if (selected) owner.selectPassport(selected.id);
  };
  const passportTitle = creator ? formatPassportTitle(creator.celebrity.name, locale) : "";
  const passportValue = creator?.passport ? formatPassportValue(creator.passport.tier, creator.passport.score, locale, creator.passport.stageProgress ?? undefined) : "";
  return (
    <section className={styles.signedInSummary} aria-labelledby={headingId}>
      <div className={styles.signedInGreeting}><h2 id={headingId}>{summary.profile.nickname ? `${summary.profile.nickname}${locale === "ko" ? "님, " : ", "}${t.welcome}` : t.welcome}</h2></div>
      <div className={styles.summarySection}>
        <div className={styles.summarySectionHeader}><span>{t.myPassport}</span>{passportCount > 1 ? <small>{locale === "ko" ? `${passportCount}개` : passportCount}</small> : null}</div>
        {creator?.passport ? <><div className={styles.passportCarousel} role="group" aria-roledescription={locale === "ko" ? "Passport 슬라이드" : "Passport carousel"} aria-label={t.myPassport}>
          <div className={styles.ownedPassportPreview}>
            <Link className={styles.ownedPassportLink} href={`/passports/${creator.passport.id}${localeQuery}` as Route} aria-label={`${passportTitle}, ${passportValue}`}>
              <PassportIdentityArtwork
                key={creator.passport.id}
                celebrity={creator.celebrity}
                level={creator.passport.tier}
                stamps={passportPreview.stamps}
                totalCount={passportPreview.totalCount}
                locale={locale}
                priority={placement === "desktop"}
                loading={passportPreview.status === "loading"}
              />
            </Link>
            <div className={styles.passportGrade}>
              <FanStageTooltip key={creator.passport.id} celebrityName={creator.celebrity.name}
                tier={creator.passport.tier} points={creator.passport.score}
                stageProgress={creator.passport.stageProgress} remainingToNextTier={creator.passport.remainingToNextTier}
                locale={locale} />
            </div>
          </div>
          <div className={`${styles.passportUtilityRow} ${passportCount === 1 ? styles.passportUtilityRowSingle : ""}`}>
          {passportCount > 1 ? <div className={styles.passportControls} aria-label={locale === "ko" ? "패스포트 선택" : "Choose a Fan Passport"}>
            <button type="button" onClick={() => selectPassport(activePassportIndex - 1)} aria-label={locale === "ko" ? "이전 패스포트" : "Previous Fan Passport"}><ChevronLeft /></button>
            <div className={styles.passportDots}>{passportCreators.map((item, index) => <button key={item.passport?.id ?? item.celebrity.slug} type="button" aria-current={index === activePassportIndex ? "true" : undefined} aria-label={formatPassportTitle(item.celebrity.name, locale)} onClick={() => selectPassport(index)}><span /></button>)}</div>
            <button type="button" onClick={() => selectPassport(activePassportIndex + 1)} aria-label={locale === "ko" ? "다음 패스포트" : "Next Fan Passport"}><ChevronRight /></button>
          </div> : null}
            <Link className={styles.passportCollectionLink} href={`/passports${localeQuery}` as Route}>{t.allPassports}<ChevronRight /></Link>
          </div>
        </div></> : <div className={styles.summaryEmpty}><Image className={styles.emptyPassportPreview} src="/images/guest-home/passport-open-blank-9-transparent.png" alt={t.passportPreview} width={1536} height={1024}/><p>{t.noPassport}</p><span className={styles.emptyPassportHint}>{t.passportPreviewHint}</span><Link className={styles.summaryOutlineAction} href={`/celebrities${localeQuery}` as Route}>{t.findFavorite}<ArrowRight /></Link></div>}
      </div>
      <div className={styles.summarySection}>
        <div className={styles.summarySectionHeader}><span>{t.reservedLive}</span></div>
        {reservation ? <Link
          className={styles.reservationSummary}
          data-reserved-live={reservation.id}
          data-has-avatar={Boolean(reservationCreator)}
          href={`/live/${reservation.slug}${localeQuery}` as Route}
          aria-label={`${reservation.title} ${t.liveDetails}`}
        >
          {reservationCreator ? <CreatorAvatar slug={reservationCreator.slug} src={reservationCreator.image} photos={reservationCreator.photos} position={reservationCreator.imagePosition} size={56} /> : null}
          <div className={styles.reservationContent}>
            <h3>{reservation.title}</h3>
            <div className={styles.reservationMeta}>
              <time dateTime={reservation.startsAt}>{formatLiveDate(reservation.startsAt, locale)}</time>
              <LiveTimeIndicator event={reservation} locale={locale} variant="text" onStartReached={owner.retryPersonalization}/>
            </div>
          </div>
          <ChevronRight className={styles.reservationArrow} aria-hidden="true" />
        </Link> : <div className={styles.summaryEmpty}><CalendarHeart aria-hidden="true"/><p>{t.noReservation}</p><Link className={styles.summaryTextLink} href={`/live${localeQuery}` as Route}>{t.browseLive}<ChevronRight /></Link></div>}
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

function ContentLoadError({ locale }: { locale: ContentLocale }) {
  const router = useRouter();
  return <div className={styles.personalizationState} role="alert"><strong>{copy[locale].retryTitle}</strong><span>{copy[locale].retryHelp}</span><button type="button" onClick={() => router.refresh()}>{copy[locale].retry}</button></div>;
}

type GuestHomeProps = { celebrities: readonly PublishedCelebrity[]; celebrityLives?: readonly PublishedCelebrityLive[]; featuredLives: readonly LiveEventResponse[]; locale: ContentLocale; contentErrors?: HomeContentErrors; initialOwnedOnly?: boolean; initialRole?: CreatorRoleFilter };

export function GuestHome(props: GuestHomeProps) {
  const creatorSlugs = props.celebrities.map((celebrity) => celebrity.slug);
  return <HomeOwnerProvider creatorSlugs={creatorSlugs} locale={props.locale}><GuestHomeContent {...props} /></HomeOwnerProvider>;
}

function GuestHomeContent({ celebrities, celebrityLives = [], featuredLives, locale, contentErrors = {}, initialOwnedOnly = false, initialRole = "all" }: GuestHomeProps) {
  const t = copy[locale];
  const router = useRouter();
  const refreshLiveStatus = useCallback(() => router.refresh(), [router]);
  const localeQuery = `?locale=${locale}`;
  const [upcomingPage, setUpcomingPage] = useState(0);
  const owner = useHomeOwner();
  const personalization = { state: owner.personalization, retry: owner.retryPersonalization };
  const orderedCreators = orderCreatorsForDiscovery(celebrities);
  const [ownedOnly, setOwnedOnly] = useState(initialOwnedOnly);
  const [role, setRole] = useState<CreatorRoleFilter>(initialOwnedOnly ? "all" : initialRole);
  const ownedSlugs = personalization.state.status === "authenticated-ready"
    ? new Set(personalization.state.summary.creators.flatMap((creator) => creator.passport ? [creator.celebrity.slug] : []))
    : new Set<string>();
  const hasOwnedPassport = personalization.state.status === "authenticated-ready" && personalization.state.summary.collection.passportCount > 0;
  const visibleCreators = orderedCreators.filter((creator) => matchesCreatorRole(creator.roles, role) && (!ownedOnly || (personalization.state.status === "authenticated-ready" && ownedSlugs.has(creator.slug))));
  const directoryQuery = new URLSearchParams({ locale });
  if (ownedOnly) directoryQuery.set("owned", "1");
  else if (role !== "all") directoryQuery.set("role", role);
  const directoryHref = `/celebrities?${directoryQuery}` as Route;
  const homeOwnedQuery = new URLSearchParams({ locale, owned: "1" });
  const ownedLoginHref = `/login?${new URLSearchParams({ locale, returnTo: `/?${homeOwnedQuery}` })}` as Route;

  const replaceHomeFilterUrl = (nextOwnedOnly: boolean, nextRole: CreatorRoleFilter) => {
    const url = new URL(window.location.href);
    if (nextOwnedOnly) url.searchParams.set("owned", "1");
    else url.searchParams.delete("owned");
    if (!nextOwnedOnly && nextRole !== "all") url.searchParams.set("role", nextRole);
    else url.searchParams.delete("role");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const changeRole = (nextRole: CreatorRoleFilter) => {
    setOwnedOnly(false);
    setRole(nextRole);
    replaceHomeFilterUrl(false, nextRole);
  };
  const selectOwned = () => {
    if (personalization.state.status === "guest") {
      router.push(ownedLoginHref);
      return;
    }
    setOwnedOnly(true);
    setRole("all");
    replaceHomeFilterUrl(true, "all");
  };
  const creatorRailRef = useRef<HTMLDivElement>(null);
  const [creatorScroll, setCreatorScroll] = useState({ previous: false, next: false });
  const updateCreatorScroll = useCallback(() => {
    const rail = creatorRailRef.current;
    const first = rail?.querySelector<HTMLElement>("article");
    if (!rail || !first || rail.clientWidth === 0) {
      setCreatorScroll({ previous: false, next: false });
      return;
    }
    setCreatorScroll({ previous: rail.scrollLeft > 2, next: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    const rail = creatorRailRef.current;
    if (!rail) return;
    rail.scrollLeft = 0;
    updateCreatorScroll();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateCreatorScroll);
    observer?.observe(rail);
    window.addEventListener("resize", updateCreatorScroll);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateCreatorScroll); };
  }, [updateCreatorScroll, visibleCreators.length, ownedOnly, role]);
  const moveCreators = (direction: number) => {
    const rail = creatorRailRef.current;
    const card = rail?.querySelector<HTMLElement>("article");
    if (!rail || !card) return;
    const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 0;
    const stride = card.getBoundingClientRect().width + gap;
    const count = Math.max(1, Math.floor((rail.clientWidth + gap + 1) / stride));
    rail.scrollBy({ left: direction * stride * count, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const upcomingPageCount = Math.max(1, Math.ceil(featuredLives.length / UPCOMING_LIVE_PAGE_SIZE));
  const visibleFeaturedLives = featuredLives.slice(
    upcomingPage * UPCOMING_LIVE_PAGE_SIZE,
    (upcomingPage + 1) * UPCOMING_LIVE_PAGE_SIZE,
  );
  const liveByCelebrity = new Map(celebrityLives.map((live) => [live.celebritySlug, live]));
  const firstPreviewId =
    visibleCreators.find((celebrity) => liveByCelebrity.get(celebrity.slug)?.preview)
      ?.slug ?? null;

  useEffect(() => {
    setUpcomingPage((currentPage) => Math.min(currentPage, upcomingPageCount - 1));
  }, [upcomingPageCount]);

  return (
    <FanAppFrame
      locale={locale}
      mainId="main-content"
    >
    <div className={styles.page} data-fan-pulse-home data-candidate="03">
      <div className={styles.shell}>
        <main id="main-content" className={styles.main}>
          <section className={styles.heroSection} aria-labelledby="live-heading">
            <FanSectionHeader variant="editorial" as="h1" id="live-heading" title={t.liveHeading} description={t.liveSub} accessory={<Link className={styles.textLink} href={`/live${localeQuery}` as Route}>{t.allLive} <ChevronRight /></Link>} />
            {contentErrors.featuredLives ? <ContentLoadError locale={locale} /> : <LiveHeroCarousel featuredLives={featuredLives} locale={locale} onStartReached={refreshLiveStatus} />}
          </section>

          <div className={styles.mobilePersonalization}>
            {personalization.state.status === "guest" ? (
              <section className={styles.mobileContextActions} aria-label={t.context}>
                <Link className={styles.googleAction} data-service-accent="spectrum-outline" href={`/login${localeQuery}`}><GoogleMark /><span>{t.google}</span></Link>
                <AuthIntentLink className={styles.passportAction} locale={locale} input={{ sourcePath: "/passports", sourceQuery: localeQuery, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><Book /><span>{t.passportIssue}</span><ArrowRight /></AuthIntentLink>
              </section>
            ) : null}
            {personalization.state.status === "authenticated-ready" ? <AuthenticatedHomeSummary locale={locale} summary={personalization.state.summary} placement="mobile" featuredLives={featuredLives} /> : null}
            {personalization.state.status === "authenticated-error" ? <PersonalizationError locale={locale} retry={personalization.retry} /> : null}
            {personalization.state.status === "auth-loading" || personalization.state.status === "authenticated-loading" ? <PersonalizationLoading locale={locale} /> : null}
            <HomeEntryCards locale={locale} />
          </div>

          <section id="celebrities" className={`${styles.contentSection} ${styles.favoriteSection}`} aria-labelledby="celebrities-heading">
            <FanSectionHeader variant="editorial" id="celebrities-heading" title={t.favorites} description={t.favoritesSub} accessory={<Link className={styles.textLink} href={directoryHref}>{t.all} <ChevronRight /></Link>} />
            {!contentErrors.celebrities && celebrities.length > 0 ? <CreatorRoleFilterControl roles={availableCreatorRoles(celebrities)} value={role} onChange={changeRole} locale={locale} controls="home-creator-rail" ownedOnly={ownedOnly} onSelectOwned={selectOwned} ownedDisabled={!ownedOnly && (personalization.state.status === "auth-loading" || personalization.state.status === "authenticated-loading")} /> : null}
            <ActivePreviewCoordinator initialActiveId={firstPreviewId}>
            {contentErrors.celebrities || contentErrors.celebrityLives ? <ContentLoadError locale={locale} /> : null}
            {!contentErrors.celebrities && ownedOnly && personalization.state.status === "guest" ? <div className={styles.favoriteFilterState} role="status"><p>{t.myFavoritesGuest}</p><Link href={ownedLoginHref}>{t.signIn}</Link></div> : null}
            {!contentErrors.celebrities && ownedOnly && (personalization.state.status === "auth-loading" || personalization.state.status === "authenticated-loading") ? <div className={styles.favoriteFilterState} role="status"><p>{t.myFavoritesLoading}</p></div> : null}
            {!contentErrors.celebrities && ownedOnly && personalization.state.status === "authenticated-error" ? <div className={styles.favoriteFilterState} role="alert"><p>{t.myFavoritesError}</p><button type="button" onClick={personalization.retry}>{t.retry}</button></div> : null}
            {!contentErrors.celebrities && ownedOnly && personalization.state.status === "authenticated-ready" && visibleCreators.length === 0 ? <div className={styles.favoriteFilterState} role="status"><strong>{hasOwnedPassport ? t.myFavoritesUnavailable : t.myFavoritesEmpty}</strong><p>{hasOwnedPassport ? t.myFavoritesUnavailableHelp : t.myFavoritesHelp}</p><button type="button" onClick={() => changeRole("all")}>{t.all}</button></div> : null}
            {!contentErrors.celebrities && (!ownedOnly || (personalization.state.status === "authenticated-ready" && visibleCreators.length > 0)) ? <div className={styles.celebrityCarousel}>
            <div id="home-creator-rail" ref={creatorRailRef} className={styles.celebrityRail} aria-label={t.celebrityList} onScroll={updateCreatorScroll}>
              {visibleCreators.map((celebrity) => {
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
                      <CreatorPortrait locale={locale} slug={celebrity.slug} image={celebrity.image} />
                    )}
                  </Link>
                  <div className={styles.celebrityInfo}>
                    <div className={styles.celebrityMetaRow}>
                      <h3>{celebrity.name}</h3>
                      <CreatorFanLink slug={celebrity.slug} name={celebrity.name} locale={locale} />
                    </div>
                    <CreatorRolesText roles={celebrity.roles} locale={locale} />
                    <div className={styles.celebrityMetaRow}>
                      <p className={styles.fanCount}>{formatFanCount(celebrity.fanCount)}</p>
                      <div className={styles.socialLinks} role="group" aria-label={`${celebrity.name} ${locale === "ko" ? "소셜 채널" : "social channels"}`}>
                        {celebrity.socialLinks.map((social) => <a className={styles.socialLink} href={social.url} target="_blank" rel="noreferrer" aria-label={`${celebrity.name} ${social.platform === "chzzk" && locale === "en" ? "CHZZK" : socialLabel[social.platform]} ${t.social}`} data-social-icon-only="true" data-platform={social.platform} key={social.platform}><Image src={social.platform === "chzzk" ? "/images/guest-home/chzzk.png" : `/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} aria-hidden="true" /></a>)}
                      </div>
                    </div>
                  </div>
                </article>
              )})}
              {celebrities.length === 0 ? <p role="status">{t.noCelebrities}</p> : null}
            </div>
            {creatorScroll.previous || creatorScroll.next ? (
              <nav className={styles.creatorControls} aria-label={locale === "ko" ? "최애 목록 이동" : "Browse creators"}>
                <button type="button" aria-label={locale === "ko" ? "이전 최애" : "Previous creators"} aria-controls="home-creator-rail" disabled={!creatorScroll.previous} onClick={() => moveCreators(-1)}><ChevronLeft /></button>
                <button type="button" aria-label={locale === "ko" ? "다음 최애" : "Next creators"} aria-controls="home-creator-rail" disabled={!creatorScroll.next} onClick={() => moveCreators(1)}><ChevronRight /></button>
              </nav>
            ) : null}
            </div> : null}
            </ActivePreviewCoordinator>

          </section>

          <section id="upcoming" className={styles.contentSection} aria-labelledby="upcoming-heading">
            <FanSectionHeader variant="editorial" id="upcoming-heading" title={t.upcoming} description={t.upcomingSub} accessory={<Link className={styles.textLink} href={`/live${localeQuery}` as Route}>{t.allLive} <ChevronRight /></Link>} />
            {contentErrors.featuredLives ? <ContentLoadError locale={locale} /> : <div className={styles.liveList} data-paginated={upcomingPageCount > 1 ? "true" : undefined}>
              {featuredLives.length > 0 ? visibleFeaturedLives.map((featuredLive) => {
                return (
                  <article className={styles.liveRow} key={featuredLive.live.id}>
                    <CreatorAvatar slug={featuredLive.live.celebrity.slug} src={featuredLive.live.celebrity.image} photos={featuredLive.live.celebrity.photos} position={featuredLive.live.celebrity.imagePosition} size={{ mobile: 56, desktop: 64 }} />
                    <div className={styles.liveDetails}><span>{featuredLive.live.celebrity.name}</span><h3>{featuredLive.live.title}</h3><p>{formatLiveDate(featuredLive.live.startsAt, locale)}</p></div>
                    <div className={styles.liveMeta}><LiveTimeIndicator event={featuredLive.live} locale={locale} onStartReached={refreshLiveStatus} /></div>
                    <Link className={styles.rowAction} href={`/live/${featuredLive.live.slug}${localeQuery}` as Route} aria-label={`${featuredLive.live.title} ${t.detail}`}><ChevronRight /></Link>
                  </article>
                );
              }) : <p>{t.noLive}</p>}
            </div>}
            {!contentErrors.featuredLives && upcomingPageCount > 1 ? (
              <nav className={styles.livePagination} aria-label={t.upcoming}>
                <button type="button" aria-label={t.previousLivePage} disabled={upcomingPage === 0} onClick={() => setUpcomingPage((page) => Math.max(0, page - 1))}><ChevronLeft /></button>
                <span aria-live="polite" aria-atomic="true">{upcomingPage + 1} / {upcomingPageCount}</span>
                <button type="button" aria-label={t.nextLivePage} disabled={upcomingPage === upcomingPageCount - 1} onClick={() => setUpcomingPage((page) => Math.min(upcomingPageCount - 1, page + 1))}><ChevronRight /></button>
              </nav>
            ) : null}
          </section>
        </main>

        <aside id="guest-context-panel" className={styles.contextPanel} aria-label={personalization.state.status === "guest" ? t.guestPanel : t.signedInPanel}>
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
          {personalization.state.status === "authenticated-ready" ? <AuthenticatedHomeSummary locale={locale} summary={personalization.state.summary} placement="desktop" featuredLives={featuredLives} /> : null}
          {personalization.state.status === "authenticated-error" ? <PersonalizationError locale={locale} retry={personalization.retry} /> : null}
          {personalization.state.status === "auth-loading" || personalization.state.status === "authenticated-loading" ? <PersonalizationLoading locale={locale} /> : null}
          <HomeEntryCards locale={locale} />
        </aside>
      </div>

    </div>
    </FanAppFrame>
  );
}
