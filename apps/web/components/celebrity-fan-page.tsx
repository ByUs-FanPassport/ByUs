"use client";

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__celebrity-fan-page";
import { additionalLocales, translate } from "@/i18n/messages";
import { BanksyFanBanner } from "./banksy-promotion/banksy-promotion";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, type CSSProperties } from "react";
import { ArrowRight, BadgeCheck, BookOpen } from "lucide-react";
import { FanAppFrame, FanContentContainer } from "./fan-shell/fan-app-shell";
import { AuthIntentLink } from "./auth-intent-link";
import { useOwnedFanResource } from "./fan-ui/use-owned-fan-resource";
import { resolveCreatorHeroImage } from "./fan-ui/creator-image-config";
import { CreatorHeroPicture } from "./fan-ui/creator-hero-picture";
import { FanCommunity } from "@/features/fanpage/ui/fan-community";
import { CheerComments } from "@/features/fanpage/ui/cheer-comments";
import { ReactionAction } from "@/features/reaction/ui/reaction-action";
import { Avatar, AvatarPlaceholder } from "@/features/profile/ui/avatar";
import { useAvatar } from "@/features/profile/ui/use-avatar";
import { mySummarySchema } from "@/features/my/domain/my-summary";
import { levelLabel } from "@/features/passport/domain/passport-read-model";
import { CelebrityMiniCalendar } from "@/features/fanpage/ui/celebrity-calendar";
import { LeaderboardPanel } from "@/features/fanpage/ui/leaderboard-panel";
import { FanActivityPanel } from "@/features/fanpage/ui/fan-activity-panel";
import { FanScoreProgress } from "@/features/fanpage/ui/fan-score-progress";
import { FanTierBadge } from "@/features/rewards/ui/fan-tier-badge";
import { fanStageLabel } from "@/features/rewards/domain/fan-stage";
import { CertificationPanel } from "@/features/certification/ui/certification-panel";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";
import { CreatorLivePanel, RafflePanel, RecentLive, useCreatorRaffles } from "@/features/fanpage/ui/home-panels";
import { InstagramRecentActivity } from "./instagram-recent-activity";
import { CreatorNews, type NewsFilter } from "@/features/fanpage/ui/chzzk-posts";
import { chzzkChannelId } from "@/features/fanpage/domain/chzzk-posts";
import { pageViewIdempotencyKey, recordProductEventV1 } from "@/features/analytics/client/product-event-client";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "@/server/content/content-domain";
import styles from "@/features/fanpage/ui/fanpage.module.css";
import { CreatorRolesText } from "./fan-ui/creator-roles";
import { ElinaMissionEntry } from "@/features/live/ui/elina-mission-entry";
import { ElinaAttendanceEntry } from "@/features/live/ui/elina-attendance-entry";
import { FanTicketGuide } from "@/features/tickets/ui/fan-ticket-guide";
import { useByUsSession } from "./byus-session-provider";
export { flattenLiveCatalog } from "@/features/fanpage/domain/live-catalog";

export type CelebrityFanTab = "home" | "certifications" | "raffles" | "leaderboard" | "notice" | "live" | "benefits";
const mainTabs = ["home", "certifications", "raffles", "leaderboard"] as const;
const labels = { ko: { home: "홈", certifications: "찐팬 인증", raffles: "래플 응모", leaderboard: "리더보드" }, en: { home: "Home", certifications: "Fan verification", raffles: "Raffles", leaderboard: "Leaderboard" } ,
  ...additionalLocales((translationLocale) => ({ home: localizedMessages.mf4c213b8593e[translationLocale], certifications: localizedMessages.m2bc194a0a5a0[translationLocale], raffles: localizedMessages.m6172ae5badc6[translationLocale], leaderboard: localizedMessages.madeb99f7d16f[translationLocale] }))
};
const socialLabels = {
  ko: { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", chzzk: "치지직" },
  en: { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", chzzk: "CHZZK" },

  ...additionalLocales((translationLocale) => ({ instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", chzzk: localizedMessages.m912b89a327a1[translationLocale] }))
} as const;
const parseSummary = (body: unknown) => mySummarySchema.parse((body as { summary: unknown }).summary);

export function CelebrityFanPage({ celebrity, locale, upcomingLive, initialTab = "home", initialNewsFilter = "all", instagramEnabled = false }: { celebrity: PublishedCelebrity; locale: AppLocale; upcomingLive: PublishedCelebrityLive | null; initialTab?: CelebrityFanTab; initialNewsFilter?: NewsFilter; instagramEnabled?: boolean }) {
  const auth = usePrivy();
  const { ready, authenticated, getAccessToken } = auth;
  const session = useByUsSession();
  const sessionReady = ready && session.ready;
  const requestAuthenticated = sessionReady && authenticated;
  const ko = locale === "ko";
  const my = useOwnedFanResource(`/api/me/summary?locale=${toContentLocale(locale)}&tierStages=1`, parseSummary, auth);
  const avatar = useAvatar();
  const raffles = useCreatorRaffles(celebrity.slug, locale);
  const tab = initialTab === "benefits" ? "raffles" : initialTab;
  const creator = my.state.status === "ready" ? my.state.data.creators.find((item) => item.celebrity.slug === celebrity.slug) : undefined;
  const nickname = my.state.status === "ready" ? my.state.data.profile.nickname : null;
  const passport = creator?.passport;
  const stage = passport?.stageProgress;
  const stageName = stage ? fanStageLabel(locale, stage.current) : passport ? levelLabel(locale, passport.tier) : null;
  const ticketBalance = requestAuthenticated && my.state.status === "ready" ? creator?.ticketBalance ?? 0 : null;
  const tabHref = (value: CelebrityFanTab) => value === "raffles"
    ? creatorRafflesHref(celebrity.slug, locale)
    : `${creatorHomeHref(celebrity.slug)}?tab=${value}&locale=${locale}#celebrity-content` as Route;
  const portrait = (size: number) => avatar.state.status === "ready" ? <Avatar avatar={avatar.state.avatar} imageUrl={avatar.state.imageUrl} label="" size={size} /> : <AvatarPlaceholder size={size} />;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const token = requestAuthenticated ? await getAccessToken() : null;
      if (cancelled) return;
      const ownerId = token ? session.ownerId ?? auth.user?.id : null;
      if (token && !ownerId) return;
      const idempotencyKey = await pageViewIdempotencyKey("creator_page_view", `/c/${celebrity.slug}`, ownerId ?? null);
      if (cancelled) return;
      await recordProductEventV1({ eventName: "creator_page_view", celebrityId: null, liveEventId: null, missionId: null, benefitId: null, source: "fan.creator.detail", idempotencyKey, properties: { celebritySlug: celebrity.slug } }, token);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, requestAuthenticated, getAccessToken, celebrity.slug, auth.user?.id, session.generation, session.ownerId]);
  const hero = resolveCreatorHeroImage(celebrity.slug, celebrity.image);
  const verifyLink = <AuthIntentLink className={styles.primaryButton} locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: `?locale=${locale}`, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}>{locale === "ko" ? "퀴즈 풀고 팬 인증하기" : translate(locale, localizedMessages.m58e2f1f8977e, "Verify fandom")}<ArrowRight aria-hidden="true" /></AuthIntentLink>;
  const channelId = chzzkChannelId(celebrity.socialLinks);
  const recent = <RecentLive celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} />;
  return <FanAppFrame locale={locale} mainId="celebrity-detail-main" actions={sessionReady && auth.authenticated ? <Link className={styles.headerIdentity} href={`/my?locale=${locale}`}>{portrait(36)}<span>{nickname ?? "MY"}</span></Link> : sessionReady ? <Link className={styles.headerLogin} href={`/login?locale=${locale}&returnTo=${encodeURIComponent(`${creatorHomeHref(celebrity.slug)}?locale=${locale}`)}` as Route}>{locale === "ko" ? "로그인" : translate(locale, localizedMessages.m4ec129dd4b3e, "Sign in")}</Link> : undefined}>
    <FanContentContainer as="main" id="celebrity-detail-main" className={styles.page} tabIndex={-1}>
      {celebrity.slug === "elina" && <BanksyFanBanner available={raffles.available} locale={locale} />}
      <section className={styles.hero} data-dedicated-hero={hero ? celebrity.slug : undefined} style={{ "--hero-desktop-position": hero?.desktopPosition ?? celebrity.image.position, "--hero-mobile-position": hero?.mobilePosition ?? celebrity.image.position, "--hero-desktop-fit": hero?.desktopFit ?? "cover", backgroundColor: hero?.background } as CSSProperties} aria-labelledby="celebrity-heading">
        <CreatorHeroPicture locale={locale} slug={celebrity.slug} image={celebrity.image} className={styles.heroPicture} priority /><div className={styles.scrim} aria-hidden="true" />
        <div className={styles.heroContent}><p className={styles.eyebrow}>BYUS FAN PAGE</p><h1 id="celebrity-heading">{celebrity.name}</h1><CreatorRolesText roles={celebrity.roles} locale={locale} /><p>{locale === "ko" ? "최근 활동과 LIVE 소식을 한곳에서" : translate(locale, localizedMessages.m9bcb85b2bed2, "Recent activity and LIVE updates in one place.")}</p><div className={styles.socials}>{celebrity.socialLinks.map((social) => { const socialLabel = socialLabels[locale][social.platform]; return <a key={social.platform} href={social.url} target="_blank" rel="noopener noreferrer" aria-label={`${socialLabel}, ${locale === "ko" ? "새 창" : translate(locale, localizedMessages.me1f5c62bd1d6, "new window")}`} data-platform={social.platform}><Image src={social.platform === "chzzk" ? "/images/guest-home/chzzk.png" : `/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} /><span>{socialLabel}</span></a>; })}</div>{sessionReady ? <><ReactionAction slug={celebrity.slug} locale={locale} variant="compact" /><FanCommunity slug={celebrity.slug} locale={locale} /></> : null}</div>
      </section>
      <ElinaAttendanceEntry celebritySlug={celebrity.slug} locale={locale} />
      <nav className={styles.tabs} aria-label={locale === "ko" ? `${celebrity.name} 팬페이지 메뉴` : translate(locale, localizedMessages.m0f2000ce3e28, "{0} fan page menu", [celebrity.name])}>{mainTabs.map((value) => <Link key={value} href={tabHref(value)} aria-current={tab === value ? "page" : undefined}>{value === "raffles" && raffles.available.length > 0 ? <span className={styles.availableRaffleTab}>{labels[locale][value]}{" "}<span>{raffles.available.length}</span></span> : labels[locale][value]}</Link>)}</nav>
      <section className={`${styles.fanbar} ${passport ? styles.ownedFanbar : ""}`} aria-label={locale === "ko" ? "내 팬 활동" : translate(locale, localizedMessages.mfd82d54cca54, "My fan activity")}>
        {!sessionReady || (auth.authenticated && my.state.status === "loading") ? <p role="status">{locale === "ko" ? "내 팬 활동을 확인하고 있어요." : translate(locale, localizedMessages.mf1295c4df607, "Loading your fan activity.")}</p> : auth.authenticated && my.state.status === "error" ? <p role="alert">{locale === "ko" ? "내 팬 활동을 불러오지 못했어요." : translate(locale, localizedMessages.m0aea4924b59e, "Couldn't load your fan activity.")} <button onClick={my.retry}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m99f026b1d3a8, "Retry")}</button></p> : passport ? <>
          <div className={styles.fanIdentity}>{portrait(48)}<strong>{nickname ?? (locale === "ko" ? "내 팬 활동" : translate(locale, localizedMessages.m33aabe47ea2a, "My activity"))}</strong>{tab === "home" && <FanTicketGuide creatorSlug={celebrity.slug} creatorName={celebrity.name} locale={locale} compact checkinOnly />}</div>
          <span className={styles.tier} data-tier={passport.tier}><FanTierBadge tier={passport.tier} stageKey={stage?.current.key} locale={locale} size={32} />{stageName}</span>
          <div className={styles.fanProgress}>
            <div className={styles.progressHeading}>
              <span>{stage ? stage.next ? <>{locale === "ko" ? `${fanStageLabel(locale, stage.next)}까지` : translate(locale, localizedMessages.m50ddf6278ab0, "To {0}", [fanStageLabel(locale, stage.next)])} <strong>{stage.remaining.toLocaleString(locale)}{locale === "ko" ? "점" : translate(locale, localizedMessages.m630bc8843593, " points")}</strong></> : (locale === "ko" ? "최고 단계 달성" : translate(locale, localizedMessages.m29ba29df317d, "Top stage reached")) : passport.tier === "Diamond" ? (locale === "ko" ? "최고 등급 달성" : translate(locale, localizedMessages.m499225dbee28, "Top tier reached")) : <>{locale === "ko" ? "다음 등급까지" : translate(locale, localizedMessages.mebc103264c9f, "To next tier")} <strong>{passport.remainingToNextTier.toLocaleString(locale)}{locale === "ko" ? "점" : translate(locale, localizedMessages.m630bc8843593, " points")}</strong></>}</span>
              <Link className={styles.passportLink} href={`/passports/${passport.id}?locale=${locale}`}><BookOpen aria-hidden="true" />{locale === "ko" ? "내 패스포트" : translate(locale, localizedMessages.m416360f1aadc, "My Passport")}<ArrowRight aria-hidden="true" /></Link>
            </div>
            <FanScoreProgress key={passport.id} passport={passport} locale={locale} />
          </div>
        </> : <><div><strong>{locale === "ko" ? `${celebrity.name} 팬 인증하고, 함께한 순간을 모아 보세요.` : translate(locale, localizedMessages.m0e9a04d5d42a, "Verify your {0} fandom and collect your moments.", [celebrity.name])}</strong><p>{locale === "ko" ? "퀴즈로 패스포트를 만들고 팬 활동을 시작하세요." : translate(locale, localizedMessages.m363016fa1279, "Create a Passport with a quiz and start your fan journey.")}</p></div>{verifyLink}</>}
      </section>
      <div id="celebrity-content" className={styles.content}>
        {tab === "home" ? <>{sessionReady ? <ElinaMissionEntry celebritySlug={celebrity.slug} locale={locale} /> : null}<RafflePanel slug={celebrity.slug} name={celebrity.name} locale={locale} preview ticketBalance={ticketBalance} resource={raffles} /><div className={styles.homeGrid}><div className={styles.mainColumn}>
          {instagramEnabled ? <InstagramRecentActivity slug={celebrity.slug} locale={locale} fallback={recent} /> : (channelId && !upcomingLive ? null : recent)}
          <CreatorNews key={`${celebrity.slug}:${initialNewsFilter}:home`} slug={celebrity.slug} locale={locale} initialFilter={initialNewsFilter} channelId={channelId} />{sessionReady ? <CheerComments slug={celebrity.slug} name={celebrity.name} locale={locale} /> : null}
        </div><aside className={styles.sideColumn}><CelebrityMiniCalendar key={celebrity.slug} celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} /><section className={styles.certificationCta}><p className={styles.eyebrow}><BadgeCheck aria-hidden="true" />{locale === "ko" ? "찐팬 인증" : translate(locale, localizedMessages.ma487b133d988, "Fan verification")}</p><h2>{ko ? <>좋아하는 마음을<br />찐팬 인증으로 남겨요</> : translate(locale, localizedMessages.mf444b267ae91, "Make your fandom part of your story.")}</h2><p>{locale === "ko" ? "멤버십 · 티켓 · 현장 인증으로 팬 활동을 기록하세요." : translate(locale, localizedMessages.m2e295c5fb59b, "Record memberships, tickets, and on-site moments.")}</p><Link className={styles.primaryButton} href={tabHref("certifications")}>{locale === "ko" ? "인증 미션 보기" : translate(locale, localizedMessages.m2733b5519c3d, "View verification missions")}<ArrowRight aria-hidden="true" /></Link><Link className={styles.historyLink} href={`/c/${celebrity.slug}/certifications?locale=${locale}`}>{locale === "ko" ? "내 인증 내역" : translate(locale, localizedMessages.mdce114bd4ae5, "My verifications")} →</Link></section><FanActivityPanel slug={celebrity.slug} locale={locale} /></aside></div></>
        : tab === "certifications" ? <><FanTicketGuide creatorSlug={celebrity.slug} creatorName={celebrity.name} locale={locale} /><CertificationPanel slug={celebrity.slug} locale={locale} /></> : tab === "raffles" ? <RafflePanel slug={celebrity.slug} name={celebrity.name} locale={locale} ticketBalance={ticketBalance} resource={raffles} /> : tab === "leaderboard" ? <LeaderboardPanel slug={celebrity.slug} locale={locale} /> : tab === "notice" ? (<CreatorNews key={`${celebrity.slug}:${initialNewsFilter}:full`} slug={celebrity.slug} locale={locale} initialFilter={initialNewsFilter} channelId={channelId} full />) : <CreatorLivePanel slug={celebrity.slug} locale={locale} />}
      </div>
    </FanContentContainer>
  </FanAppFrame>;
}
