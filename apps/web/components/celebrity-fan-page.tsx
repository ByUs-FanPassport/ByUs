"use client";
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
import { LoungeHome } from "@/features/lounge/ui/lounge-screen";
import { ReactionAction } from "@/features/reaction/ui/reaction-action";
import { Avatar, AvatarPlaceholder } from "@/features/profile/ui/avatar";
import { useAvatar } from "@/features/profile/ui/use-avatar";
import { mySummarySchema } from "@/features/my/domain/my-summary";
import { levelLabel } from "@/features/passport/domain/passport-read-model";
import { fanpageSummarySchema } from "@/features/fanpage/domain/community";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { CelebrityMiniCalendar } from "@/features/fanpage/ui/celebrity-calendar";
import { LeaderboardPanel } from "@/features/fanpage/ui/leaderboard-panel";
import { FanActivityPanel } from "@/features/fanpage/ui/fan-activity-panel";
import { FanScoreProgress } from "@/features/fanpage/ui/fan-score-progress";
import { FanTierBadge } from "@/features/rewards/ui/fan-tier-badge";
import { fanStageLabel } from "@/features/rewards/domain/fan-stage";
import { CertificationPanel } from "@/features/certification/ui/certification-panel";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";
import { CreatorLivePanel, NoticePanel, RafflePanel, RecentLive } from "@/features/fanpage/ui/home-panels";
import { InstagramRecentActivity } from "./instagram-recent-activity";
import { pageViewIdempotencyKey, recordProductEventV1 } from "@/features/analytics/client/product-event-client";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "@/server/content/content-domain";
import styles from "@/features/fanpage/ui/fanpage.module.css";
import { CreatorRolesText } from "./fan-ui/creator-roles";
import { ElinaMissionEntry } from "@/features/live/ui/elina-mission-entry";
export { flattenLiveCatalog } from "@/features/fanpage/domain/live-catalog";

export type CelebrityFanTab = "home" | "certifications" | "raffles" | "leaderboard" | "notice" | "live" | "benefits";
const mainTabs = ["home", "certifications", "raffles", "leaderboard"] as const;
const labels = { ko: { home: "홈", certifications: "찐팬 인증", raffles: "래플 응모", leaderboard: "리더보드" }, en: { home: "Home", certifications: "Fan verification", raffles: "Raffles", leaderboard: "Leaderboard" } };
const socialLabels = {
  ko: { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", chzzk: "치지직" },
  en: { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", chzzk: "CHZZK" },
} as const;
const parseSummary = (body: unknown) => mySummarySchema.parse((body as { summary: unknown }).summary);
const parseFanpage = (body: unknown) => fanpageSummarySchema.parse(body);

export function CelebrityFanPage({ celebrity, locale, upcomingLive, initialTab = "home", instagramEnabled = false }: { celebrity: PublishedCelebrity; locale: ContentLocale; upcomingLive: PublishedCelebrityLive | null; initialTab?: CelebrityFanTab; instagramEnabled?: boolean }) {
  const auth = usePrivy();
  const { ready, authenticated, getAccessToken } = auth;
  const ko = locale === "ko";
  const my = useOwnedFanResource(`/api/me/summary?locale=${locale}&tierStages=1`, parseSummary, auth);
  const avatar = useAvatar();
  const fanpage = useFanpageResource(`/api/celebrities/${celebrity.slug}/fanpage?locale=${locale}`, parseFanpage);
  const tab = initialTab === "benefits" ? "raffles" : initialTab;
  const creator = my.state.status === "ready" ? my.state.data.creators.find((item) => item.celebrity.slug === celebrity.slug) : undefined;
  const nickname = my.state.status === "ready" ? my.state.data.profile.nickname : null;
  const passport = creator?.passport;
  const stage = passport?.stageProgress;
  const stageName = stage ? fanStageLabel(locale, stage.current) : passport ? levelLabel(locale, passport.tier) : null;
  const ticketBalance = auth.authenticated && my.state.status === "ready" ? creator?.ticketBalance ?? 0 : null;
  const tabHref = (value: CelebrityFanTab) => value === "raffles"
    ? creatorRafflesHref(celebrity.slug, locale)
    : `/c/${celebrity.slug}?tab=${value}&locale=${locale}#celebrity-content` as Route;
  const portrait = (size: number) => avatar.state.status === "ready" ? <Avatar avatar={avatar.state.avatar} imageUrl={avatar.state.imageUrl} label="" size={size} /> : <AvatarPlaceholder size={size} />;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const token = authenticated ? await getAccessToken() : null;
      if (cancelled) return;
      const ownerId = token ? auth.user?.id : null;
      if (token && !ownerId) return;
      const idempotencyKey = await pageViewIdempotencyKey("creator_page_view", `/c/${celebrity.slug}`, ownerId ?? null);
      if (cancelled) return;
      await recordProductEventV1({ eventName: "creator_page_view", celebrityId: null, liveEventId: null, missionId: null, benefitId: null, source: "fan.creator.detail", idempotencyKey, properties: { celebritySlug: celebrity.slug } }, token);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, authenticated, getAccessToken, celebrity.slug, auth.user?.id]);
  const hero = resolveCreatorHeroImage(celebrity.slug, celebrity.image);
  const verifyLink = <AuthIntentLink className={styles.primaryButton} locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: `?locale=${locale}`, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}>{ko ? "퀴즈 풀고 팬 인증하기" : "Verify fandom"}<ArrowRight aria-hidden="true" /></AuthIntentLink>;
  const recent = <RecentLive celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} />;
  return <FanAppFrame locale={locale} mainId="celebrity-detail-main" actions={auth.ready && auth.authenticated ? <Link className={styles.headerIdentity} href={`/my?locale=${locale}`}>{portrait(36)}<span>{nickname ?? "MY"}</span></Link> : auth.ready ? <Link className={styles.headerLogin} href={`/login?locale=${locale}&returnTo=${encodeURIComponent(`/c/${celebrity.slug}?locale=${locale}`)}` as Route}>{ko ? "로그인" : "Sign in"}</Link> : undefined}>
    <FanContentContainer as="main" id="celebrity-detail-main" className={styles.page} tabIndex={-1}>
      <section className={styles.hero} data-dedicated-hero={hero ? celebrity.slug : undefined} style={{ "--hero-desktop-position": hero?.desktopPosition ?? celebrity.image.position, "--hero-mobile-position": hero?.mobilePosition ?? celebrity.image.position, "--hero-desktop-fit": hero?.desktopFit ?? "cover", backgroundColor: hero?.background } as CSSProperties} aria-labelledby="celebrity-heading">
        <CreatorHeroPicture locale={locale} slug={celebrity.slug} image={celebrity.image} className={styles.heroPicture} priority /><div className={styles.scrim} aria-hidden="true" />
        <div className={styles.heroContent}><p className={styles.eyebrow}>BYUS FAN PAGE</p><h1 id="celebrity-heading">{celebrity.name}</h1><CreatorRolesText roles={celebrity.roles} locale={locale} /><p>{ko ? "최근 활동과 LIVE 소식을 한곳에서" : "Recent activity and LIVE updates in one place."}</p><div className={styles.socials}>{celebrity.socialLinks.map((social) => { const socialLabel = socialLabels[locale][social.platform]; return <a key={social.platform} href={social.url} target="_blank" rel="noopener noreferrer" aria-label={`${socialLabel}, ${ko ? "새 창" : "new window"}`} data-platform={social.platform}><Image src={social.platform === "chzzk" ? "/images/guest-home/chzzk.png" : `/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} /><span>{socialLabel}</span></a>; })}</div><ReactionAction slug={celebrity.slug} locale={locale} variant="compact" /><LoungeHome slug={celebrity.slug} locale={locale} variant="count" /></div>
      </section>
      <nav className={styles.tabs} aria-label={ko ? `${celebrity.name} 팬페이지 메뉴` : `${celebrity.name} fan page menu`}>{mainTabs.map((value) => value === "leaderboard" && !(fanpage.state.status === "ready" && fanpage.state.data.leaderboardAvailable) ? <button key={value} disabled aria-describedby="leaderboard-lock-hint">{labels[locale][value]}</button> : <Link key={value} href={tabHref(value)} aria-current={tab === value ? "page" : undefined}>{labels[locale][value]}</Link>)}</nav>
      <span id="leaderboard-lock-hint" className={styles.srOnly}>{ko ? "ByUs 패스포트 보유 팬 501명부터 리더보드가 열려요." : "Leaderboard opens at 501 ByUs Passport holders."}</span>
      <section className={`${styles.fanbar} ${passport ? styles.ownedFanbar : ""}`} aria-label={ko ? "내 팬 활동" : "My fan activity"}>
        {!auth.ready || (auth.authenticated && my.state.status === "loading") ? <p role="status">{ko ? "내 팬 활동을 확인하고 있어요." : "Loading your fan activity."}</p> : auth.authenticated && my.state.status === "error" ? <p role="alert">{ko ? "내 팬 활동을 불러오지 못했어요." : "Couldn't load your fan activity."} <button onClick={my.retry}>{ko ? "다시 시도" : "Retry"}</button></p> : passport ? <>
          <div className={styles.fanIdentity}>{portrait(48)}<strong>{nickname ?? (ko ? "내 팬 활동" : "My activity")}</strong></div>
          <span className={styles.tier} data-tier={passport.tier}><FanTierBadge tier={passport.tier} stageKey={stage?.current.key} locale={locale} size={32} />{stageName}</span>
          <div className={styles.fanProgress}>
            <div className={styles.progressHeading}>
              <span>{stage ? stage.next ? <>{ko ? `${fanStageLabel(locale, stage.next)}까지` : `To ${fanStageLabel(locale, stage.next)}`} <strong>{stage.remaining.toLocaleString(ko ? "ko-KR" : "en-US")}{ko ? "점" : " points"}</strong></> : (ko ? "최고 단계 달성" : "Top stage reached") : passport.tier === "Diamond" ? (ko ? "최고 등급 달성" : "Top tier reached") : <>{ko ? "다음 등급까지" : "To next tier"} <strong>{passport.remainingToNextTier.toLocaleString(ko ? "ko-KR" : "en-US")}{ko ? "점" : " points"}</strong></>}</span>
              <Link className={styles.passportLink} href={`/passports/${passport.id}?locale=${locale}`}><BookOpen aria-hidden="true" />{ko ? "내 패스포트" : "My Passport"}<ArrowRight aria-hidden="true" /></Link>
            </div>
            <FanScoreProgress key={passport.id} passport={passport} locale={locale} />
          </div>
        </> : <><div><strong>{ko ? `${celebrity.name} 팬 인증하고, 함께한 순간을 모아 보세요.` : `Verify your ${celebrity.name} fandom and collect your moments.`}</strong><p>{ko ? "퀴즈로 패스포트를 만들고 팬 활동을 시작하세요." : "Create a Passport with a quiz and start your fan journey."}</p></div>{verifyLink}</>}
      </section>
      <div id="celebrity-content" className={styles.content}>
        {tab === "home" ? <><ElinaMissionEntry celebritySlug={celebrity.slug} locale={locale} /><div className={styles.homeGrid}><div className={styles.loungePreview}><LoungeHome slug={celebrity.slug} locale={locale} /></div><div className={styles.mainColumn}>
          {instagramEnabled ? <InstagramRecentActivity slug={celebrity.slug} locale={locale} fallback={recent} /> : recent}
          <NoticePanel slug={celebrity.slug} locale={locale} /><RafflePanel slug={celebrity.slug} name={celebrity.name} locale={locale} preview ticketBalance={ticketBalance} />
        </div><aside className={styles.sideColumn}><CelebrityMiniCalendar key={celebrity.slug} celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} /><section className={styles.certificationCta}><p className={styles.eyebrow}><BadgeCheck aria-hidden="true" />{ko ? "찐팬 인증" : "Fan verification"}</p><h2>{ko ? <>좋아하는 마음을<br />찐팬 인증으로 남겨요</> : "Make your fandom part of your story."}</h2><p>{ko ? "멤버십 · 티켓 · 현장 인증으로 팬 활동을 기록하세요." : "Record memberships, tickets, and on-site moments."}</p><Link className={styles.primaryButton} href={tabHref("certifications")}>{ko ? "인증 미션 보기" : "View verification missions"}<ArrowRight aria-hidden="true" /></Link><Link className={styles.historyLink} href={`/c/${celebrity.slug}/certifications?locale=${locale}`}>{ko ? "내 인증 내역" : "My verifications"} →</Link></section><FanActivityPanel slug={celebrity.slug} locale={locale} /></aside></div></>
        : tab === "certifications" ? <CertificationPanel slug={celebrity.slug} locale={locale} /> : tab === "raffles" ? <RafflePanel slug={celebrity.slug} name={celebrity.name} locale={locale} ticketBalance={ticketBalance} /> : tab === "leaderboard" ? <LeaderboardPanel slug={celebrity.slug} locale={locale} /> : tab === "notice" ? <NoticePanel slug={celebrity.slug} locale={locale} full /> : <CreatorLivePanel slug={celebrity.slug} locale={locale} />}
      </div>
    </FanContentContainer>
  </FanAppFrame>;
}
