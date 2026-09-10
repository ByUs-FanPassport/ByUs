"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Bell, BookOpen, Minus, Pencil, Plus, RotateCcw, Settings, Sparkles, Star, Ticket } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useOwnedFanResource } from "../../../components/fan-ui/use-owned-fan-resource";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { GoogleMark } from "@/components/icons";
import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { fanActionClassName, FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { FanMotionIcon } from "@/components/fan-ui/fan-motion-icon";
import type { MyReward } from "../../benefit/domain/my-reward";
import { raffleListSchema } from "../../benefit/domain/raffle";
import { certificationListItemSchema, historyItemSchema } from "../../certification/domain/certification";
import { useFanpageResource } from "../../fanpage/ui/use-fanpage-resource";
import { levelLabel } from "../../passport/domain/passport-read-model";
import { mySummarySchema, type MySummary } from "../domain/my-summary";
import { FanHeading, FanSectionHeader } from "../../../components/fan-ui/fan-heading";
import { FAN_TIERS } from "../../rewards/domain/reward-policy";
import { fanStageLabel } from "../../rewards/domain/fan-stage";
import { FanTierBadge } from "../../rewards/ui/fan-tier-badge";
import { FanSurface, fanUtilityCanvasClassName } from "../../../components/fan-ui/fan-surface";
import { Avatar, AvatarPlaceholder } from "../../profile/ui/avatar";
import { useAvatar } from "../../profile/ui/use-avatar";
import { fanTierProgress, localizedPath, nextRaffleBoundary, recommendCertification, selectOpenRaffle, type MyCreator, type PassportCreator } from "../domain/my-progress";
import { MyBenefitProgress } from "./my-benefit-progress";
import { MyLiveCountdown } from "./my-live-countdown";
import styles from "./my-screen.module.css";

const copy = {
  ko: {
    title: "MY", profileSummary: "내 팬 활동", profileHelp: "최애와 함께한 기록을 한눈에 모았어요.",
    guestTitle: "내 팬 활동을 한곳에 모아보세요.", guestBody: "로그인하면 최애, 예약한 LIVE, 받은 혜택과 수집 기록을 바로 확인할 수 있어요.",
    login: "Google로 계속하기", loading: "팬 활동을 불러오는 중이에요.", error: "팬 활동을 불러오지 못했어요.", retry: "다시 시도",
    overview: "활동 요약", creators: "내 최애", creatorsHelp: "크리에이터별 패스포트와 응모권 잔액을 확인하세요.",
    noCreators: "아직 등록한 최애가 없어요.", findCreator: "최애 찾기", live: "다가오는 LIVE", upcoming: "예약 완료",
    history: "지난 LIVE", noLive: "예약한 LIVE가 없어요.", browseLive: "LIVE 둘러보기", rewards: "받은 혜택",
    available: "사용 가능한 혜택", entries: "응모", noRewards: "아직 받은 혜택이 없어요.", collection: "최근 활동",
    passports: "내 패스포트", stamps: "스탬프", collectibles: "디지털 기념품", noCollection: "아직 수집한 기록이 없어요.",
    notifications: "새 알림", settings: "설정", tickets: "응모권", firstReaction: "첫 반응",
    avatarSettings: "프로필 수정",
    allLive: "전체 LIVE 보기", allRewards: "혜택 전체 보기", fanTier: "나의 팬등급", myPassport: "내 패스포트",
    ticketPanel: "이벤트 응모권", allRaffles: "전체 래플", raffleOpen: "응모 진행 중", raffleDraw: "추첨", raffleView: "래플 자세히 보기",
    raffleEmpty: "현재 열려 있는 래플이 없어요.", raffleHelp: "응모권 사용과 응모 조건은 상세에서 확인하세요.",
    nextAction: "다음 팬 활동", noMission: "새 인증 미션을 기다리고 있어요.", viewLive: "LIVE 일정 보기", startPassport: "팬 인증 시작하기",
    missionLoading: "다음 활동을 확인하는 중이에요.", missionError: "다음 활동을 불러오지 못했어요.", manualReward: "승인 후 지급",
    tierHelp: "함께한 활동이 나의 등급이 돼요.", highestTier: "최고 등급을 달성했어요.", toNextTier: "까지",
  },
  en: {
    title: "MY", profileSummary: "My fan activity", profileHelp: "Your moments with every favorite, all in one place.",
    guestTitle: "Keep your fan activity together.", guestBody: "Sign in to see your favorites, reserved LIVE events, rewards, and collection.",
    login: "Continue with Google", loading: "Loading your fan activity.", error: "We couldn’t load your fan activity.", retry: "Try again",
    overview: "Activity overview", creators: "My favorites", creatorsHelp: "Check each Fan Passport and Raffle ticket balance.",
    noCreators: "No favorites added yet.", findCreator: "Find favorites", live: "Upcoming LIVE", upcoming: "Reserved",
    history: "Past LIVE", noLive: "No reserved LIVE events.", browseLive: "Browse LIVE", rewards: "My rewards",
    available: "Available rewards", entries: "Entries", noRewards: "No rewards received yet.", collection: "Recent collection",
    passports: "Fan Passports", stamps: "Stamps", collectibles: "Collectibles", noCollection: "Nothing collected yet.",
    notifications: "New alerts", settings: "Settings", tickets: "Raffle tickets", firstReaction: "First Reaction",
    avatarSettings: "Edit profile",
    allLive: "View all LIVE", allRewards: "View all rewards", fanTier: "My fan tier", myPassport: "My Passport",
    ticketPanel: "Event raffle tickets", allRaffles: "All raffles", raffleOpen: "Raffle open", raffleDraw: "winners", raffleView: "View raffle",
    raffleEmpty: "No raffles are open right now.", raffleHelp: "Check ticket use and entry requirements on the raffle page.",
    nextAction: "Next fan activity", noMission: "There are no new verification missions.", viewLive: "View LIVE schedule", startPassport: "Start fan verification",
    missionLoading: "Checking your next activity.", missionError: "We couldn’t load your next activity.", manualReward: "Granted after approval",
    tierHelp: "Your shared activities build your fan tier.", highestTier: "You reached the highest tier.", toNextTier: "to",
  },
} as const;

const parseSummaryResponse = (body: unknown) => mySummarySchema.parse((body as { summary: unknown }).summary);

const rewardStatusCopy: Record<MyReward["status"], { ko: string; en: string }> = {
  information_required: { ko: "정보 입력 필요", en: "Information required" },
  ready: { ko: "준비 완료", en: "Ready" },
  shipping_preparing: { ko: "배송 준비 중", en: "Preparing shipment" },
  shipping_in_transit: { ko: "배송 중", en: "In transit" },
  shipping_completed: { ko: "배송 완료", en: "Delivered" },
  pickup_available: { ko: "수령 가능", en: "Ready for pickup" },
  pickup_completed: { ko: "수령 완료", en: "Picked up" },
  digital_delivered: { ko: "지급 완료", en: "Delivered" },
  not_selected: { ko: "미선정", en: "Not selected" },
};

export function MyScreen({ locale }: { locale: FanLocale }) {
  const auth = usePrivy();
  const { ready, authenticated } = auth;
  const resource = useOwnedFanResource(`/api/me/summary?locale=${locale}&tierStages=1`, parseSummaryResponse, auth);
  const avatarResource = useAvatar();
  const state = resource.state;
  const t = copy[locale];

  const heading = <header className={styles.pageHeading}><FanHeading as="h1" variant="personal-page">{t.title}</FanHeading></header>;
  return <FanAppFrame locale={locale} className={fanUtilityCanvasClassName} mainId="my-content" currentPath="/my"><FanContentContainer as="main" className={styles.main} id="my-content" tabIndex={-1}>
    {!ready ? <>{heading}<FanState kind="loading" title={t.loading} /></>
      : !authenticated ? <>{heading}<section className={styles.guest}><BookOpen/><h2>{t.guestTitle}</h2><p>{t.guestBody}</p><AuthIntentLink className={fanActionClassName("service", { fullWidth: true })} locale={locale} input={{ sourcePath: "/my", sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><GoogleMark/><span>{t.login}</span><ArrowRight/></AuthIntentLink></section></>
      : state.status === "loading" ? <>{heading}<FanState kind="loading" title={t.loading} /></>
      : state.status === "error" ? <>{heading}<FanState kind="error" title={t.error} actions={<FanAction variant="neutral" fullWidth onClick={resource.retry}><RotateCcw/>{t.retry}</FanAction>} /></>
      : <Dashboard key={auth.user?.id ?? "current-owner"} summary={state.data} locale={locale} avatarResource={avatarResource} refreshSummary={resource.retry}/>}
  </FanContentContainer></FanAppFrame>;
}

function Dashboard({ summary, locale, avatarResource, refreshSummary }: { summary: MySummary; locale: FanLocale; avatarResource: ReturnType<typeof useAvatar>; refreshSummary: () => void }) {
  const t = copy[locale];
  const nickname = summary.profile.nickname?.trim() || null;
  const identity = nickname ? (locale === "ko" ? `${nickname}님` : nickname) : t.profileSummary;
  const hasRewards = summary.rewards.items.length > 0 || summary.rewards.availableCount > 0 || summary.rewards.entries > 0;
  const reservedLives = prioritizeReservedLives(summary.live.upcoming);
  const [selectedSlug, setSelectedSlug] = useState(summary.creators[0]?.celebrity.slug ?? null);
  const selected = summary.creators.find((creator) => creator.celebrity.slug === selectedSlug) ?? summary.creators[0] ?? null;
  const ticketBalance = summary.creators.reduce((total, creator) => total + creator.ticketBalance, 0);
  const visibleRecent = summary.collection.recent;
  const recentPreview = visibleRecent.slice(0, 3);
  const remainingRecent = visibleRecent.slice(3);
  const hasVisibleCollectible = visibleRecent.some((item) => item.kind === "collectible");
  const [recentOpen, setRecentOpen] = useState(false);
  const collectionFrame = useRef<number | null>(null);
  const openRecent = useCallback(() => {
    setRecentOpen(true);
    if (collectionFrame.current !== null) cancelAnimationFrame(collectionFrame.current);
    collectionFrame.current = requestAnimationFrame(() => {
      const collection = document.getElementById("my-collection");
      collection?.scrollIntoView({ block: "start" });
      collection?.focus({ preventScroll: true });
      collectionFrame.current = null;
    });
  }, [setRecentOpen]);
  useEffect(() => {
    const followFragment = () => { if (window.location.hash === "#my-collection") openRecent(); };
    followFragment();
    window.addEventListener("hashchange", followFragment);
    return () => {
      window.removeEventListener("hashchange", followFragment);
      if (collectionFrame.current !== null) cancelAnimationFrame(collectionFrame.current);
    };
  }, [openRecent]);

  useEffect(() => {
    if (selectedSlug && !summary.creators.some((creator) => creator.celebrity.slug === selectedSlug)) {
      setSelectedSlug(summary.creators[0]?.celebrity.slug ?? null);
    }
  }, [selectedSlug, summary.creators]);

  return <div className={styles.dashboard}>
    <header className={styles.profileHeader}>
      <Link className={styles.avatarLink} href={`/settings?locale=${locale}` as Route} aria-label={t.avatarSettings}>
        {avatarResource.state.status === "ready"
          ? <Avatar avatar={avatarResource.state.avatar} imageUrl={avatarResource.state.imageUrl} label={t.avatarSettings} size={64}/>
          : <AvatarPlaceholder size={64}/>}
        <span className={styles.avatarEdit} aria-hidden="true"><Pencil/></span>
      </Link>
      <div className={styles.profileCopy}>
        <h1>{identity}</h1><p>{t.profileHelp}</p></div>
      <div className={styles.profileActions}>
        <Link className={styles.notificationLink} href={`/notifications?locale=${locale}` as Route}><Bell aria-hidden="true"/><span>{t.notifications}</span><strong>{summary.unreadNotificationCount}</strong></Link>
        <Link className={styles.notificationLink} href={`/settings?locale=${locale}` as Route}><Settings aria-hidden="true"/><span>{t.settings}</span></Link>
      </div>
    </header>

    <FanSurface appearance="plain" className={`${styles.section} ${styles.favoritesSection}`} id="my-creators">
      <SectionTitle title={t.creators} href={`/celebrities?locale=${locale}`} action={t.findCreator}/>
      {summary.creators.length ? <div className={styles.favoriteSelector} role="group" aria-label={t.creators}>{summary.creators.map((creator) =>
        <button type="button" aria-pressed={selected?.celebrity.slug === creator.celebrity.slug} onClick={() => setSelectedSlug(creator.celebrity.slug)} key={creator.celebrity.slug}>
          <Image src={creator.celebrity.image} alt="" width={48} height={48}/><span><strong>{creator.celebrity.name}</strong><small>{creator.passport ? creator.passport.stageProgress ? fanStageLabel(locale, creator.passport.stageProgress.current) : levelLabel(locale, creator.passport.tier) : t.firstReaction} · {t.tickets} {creator.ticketBalance}</small></span>
        </button>)}</div>
        : <Empty text={t.noCreators} href={`/celebrities?locale=${locale}`} action={t.findCreator}/>}
    </FanSurface>

    {selected ? <SelectedFavoritePanels key={selected.celebrity.slug} creator={selected} locale={locale}/> : null}

    {selected?.passport ? <FanSurface tone="focus" className={styles.section}>
      <SectionTitle title={locale === "ko" ? "등급 혜택" : "Tier benefit"}/>
      <MyBenefitProgress creator={selected as PassportCreator} locale={locale}/>
    </FanSurface> : null}

    <div className={styles.lowerGrid}>
      {reservedLives.length > 0 || summary.live.history.length > 0 ? <ReservedLiveSection events={reservedLives} history={summary.live.history} locale={locale} onStartReached={refreshSummary}/> : null}
      {summary.collection.recent.length > 0 ? <FanSurface appearance="plain" className={styles.section} id="my-collection" tabIndex={-1}>
        <SectionTitle title={t.collection}/><RecentActivityRows items={recentPreview} locale={locale}/>
        {remainingRecent.length > 0 ? <details className={styles.recentDisclosure} open={recentOpen} onToggle={event => setRecentOpen(event.currentTarget.open)}>
          <summary><span>{recentOpen ? (locale === "ko" ? "접기" : "Show less") : (locale === "ko" ? `${remainingRecent.length}개 더 보기` : `Show ${remainingRecent.length} more`)}</span>{recentOpen ? <Minus aria-hidden="true"/> : <Plus aria-hidden="true"/>}</summary>
          <RecentActivityRows items={remainingRecent} locale={locale}/>
        </details> : null}
      </FanSurface> : null}
    </div>

    {hasRewards ? <FanSurface className={styles.section}>
      <SectionTitle title={t.rewards} href={`/benefits?locale=${locale}`} action={t.allRewards}/>
      <div className={styles.rewardMetrics}><Link href={`/benefits?locale=${locale}` as Route}><span className={styles.metricIcon} data-kind="gift" aria-hidden="true"><FanMotionIcon name="gift" size={20}/></span><span>{t.available}</span><strong>{summary.rewards.availableCount}</strong></Link><div><span className={styles.metricIcon} data-kind="ticket" aria-hidden="true"><FanMotionIcon name="ticket" size={20}/></span><span>{t.entries}</span><strong>{summary.rewards.entries}</strong></div></div>
      {summary.rewards.items.length ? <div className={styles.rows}>{summary.rewards.items.slice(0, 4).map((reward) =>
        <Link href={`${reward.benefitHref}?locale=${locale}` as Route} key={reward.rewardResultId}><span className={styles.activityMark} data-kind="collectible" aria-hidden="true"><FanMotionIcon name="gift" size={20}/></span><div><strong>{reward.title}</strong><span>{rewardStatusCopy[reward.status][locale]}</span></div><ArrowRight/></Link>)}</div> : <p className={styles.emptyText}>{t.noRewards}</p>}
    </FanSurface> : null}

    <section className={styles.overview} aria-labelledby="activity-overview-heading">
      <h2 id="activity-overview-heading">{t.overview}</h2><div className={styles.overviewGrid}>
        <Stat icon={<Star/>} value={summary.creators.length} label={t.creators} href="#my-creators" kind="favorite"/>
        <Stat icon={<BookOpen/>} value={summary.collection.passportCount} label={t.passports} href={`/passports?locale=${locale}`} kind="passport"/>
        <Stat icon={<Sparkles/>} value={summary.collection.stampCount} label={t.stamps} href={`/passports?locale=${locale}#collection`} kind="stamp"/>
        <Stat icon={<FanMotionIcon name="ticket" size={20} active/>} value={ticketBalance} label={t.tickets} href="#my-creators" kind="ticket"/>
        <Stat icon={<FanMotionIcon name="gift" size={20} active/>} value={summary.collection.collectibleCount} label={t.collectibles} href={hasVisibleCollectible ? "#my-collection" : undefined} onClick={hasVisibleCollectible ? openRecent : undefined} kind="collectible"/>
      </div>
    </section>

  </div>;
}

function SelectedFavoritePanels({ creator, locale }: { creator: MyCreator; locale: FanLocale }) {
  const auth = usePrivy();
  const t = copy[locale];
  const [now, setNow] = useState(() => Date.now());
  const slug = encodeURIComponent(creator.celebrity.slug);
  const parseRaffles = useCallback((body: unknown) => raffleListSchema.parse(body).raffles, []);
  const parseMissions = useCallback((body: unknown) => z.array(certificationListItemSchema).parse((body as { certifications: unknown }).certifications), []);
  const parseHistory = useCallback((body: unknown) => z.array(historyItemSchema).parse((body as { certifications: unknown }).certifications), []);
  const raffles = useFanpageResource(`/api/celebrities/${slug}/raffles?locale=${locale}`, parseRaffles);
  const missions = useFanpageResource(`/api/celebrities/${slug}/certifications?locale=${locale}`, parseMissions);
  const history = useOwnedFanResource(`/api/me/celebrities/${slug}/certifications?locale=${locale}`, parseHistory, auth);
  const raffleState = raffles.state;
  const retryRaffles = raffles.retry;
  const raffle = raffleState.status === "ready" ? selectOpenRaffle(raffleState.data, new Date(now)) : null;
  const recommendation = missions.state.status === "ready" && history.state.status === "ready"
    ? recommendCertification(missions.state.data, history.state.data, creator.passport !== null) : null;
  const recommendationHref = recommendation ? localizedPath(recommendation.actionHref, locale) : null;
  const missionState = missions.state.status === "error" || history.state.status === "error" ? "error"
    : missions.state.status === "loading" || history.state.status === "loading" ? "loading" : "ready";
  const raffleAllHref = `/c/${creator.celebrity.slug}?tab=raffles&locale=${locale}#celebrity-content` as Route;
  const liveHref = `/c/${creator.celebrity.slug}?tab=live&locale=${locale}#celebrity-content` as Route;
  useEffect(() => {
    if (raffleState.status !== "ready") return;
    const scheduledNow = Date.now();
    const refreshVisible = () => { if (document.visibilityState === "visible") { setNow(Date.now()); retryRaffles(); } };
    const timer = scheduleRaffleBoundary(raffleState.data, scheduledNow, () => setNow(Date.now()), retryRaffles);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [now, raffleState, retryRaffles]);
  return <div className={styles.corePanels}>
    <FanSurface className={styles.growthPanel}>
      <SectionTitle title={t.fanTier} href={creator.passport ? `/passports/${creator.passport.id}?locale=${locale}` : undefined} action={creator.passport ? t.myPassport : undefined}/>
      {creator.passport ? <FanGrade creator={creator as PassportCreator} locale={locale}/> : <div className={styles.startPassport}><p>{locale === "ko" ? `${creator.celebrity.name} 팬 인증을 시작하고 첫 팬등급을 만들어보세요.` : `Start ${creator.celebrity.name} fan verification to earn your first tier.`}</p><Link href={`/c/${creator.celebrity.slug}?tab=certifications&locale=${locale}#celebrity-content` as Route}>{t.startPassport}<ArrowRight/></Link></div>}
      <div className={styles.nextAction}><span>{t.nextAction}</span>{missionState === "loading" ? <p role="status">{t.missionLoading}</p>
        : missionState === "error" ? <><p role="alert">{t.missionError}</p><button type="button" onClick={() => { missions.retry(); history.retry(); }}>{t.retry}</button></>
        : recommendation ? <><strong>{recommendation.title}</strong><p>{recommendation.description}</p>{recommendation.reward ? <small>+{recommendation.reward.scorePoints} {locale === "ko" ? "팬 점수" : "Fan Score"} · +{recommendation.reward.ticketAmount} {t.tickets}{recommendation.kind === "manual" ? ` · ${t.manualReward}` : ""}</small> : null}{recommendationHref ? <Link href={recommendationHref as Route}>{t.startPassport}<ArrowRight/></Link> : null}</>
        : <><strong>{t.noMission}</strong><Link href={liveHref}>{t.viewLive}<ArrowRight/></Link></>}
      </div>
    </FanSurface>
    <FanSurface className={styles.rafflePanel}>
      <SectionTitle title={t.ticketPanel} href={raffleAllHref} action={t.allRaffles}/>
      <div className={styles.ticketTotal}><strong>{creator.ticketBalance}</strong><span>{locale === "ko" ? "장" : t.tickets}</span><p>{creator.celebrity.name} {t.tickets}</p></div>
      {raffleState.status === "loading" ? <p className={styles.panelState} role="status">{locale === "ko" ? "래플을 불러오는 중이에요." : "Loading raffles."}</p>
        : raffleState.status === "error" ? <div className={styles.panelState} role="alert"><p>{locale === "ko" ? "래플을 불러오지 못했어요." : "We couldn’t load raffles."}</p><button type="button" onClick={retryRaffles}>{t.retry}</button></div>
        : raffle ? <div className={styles.rafflePreview}>{raffle.imageUrl ? <Image src={raffle.imageUrl} width={112} height={112} alt=""/> : <span className={styles.rafflePlaceholder} aria-hidden="true"><Ticket/></span>}<div><span>{t.raffleOpen}</span><strong>{raffle.title}</strong><small>{raffle.winnerQuantity}{locale === "ko" ? "명 " : " "}{t.raffleDraw}</small><time dateTime={raffle.entryClosesAt!}>{formatClosing(raffle.entryClosesAt!, locale)}</time></div><Link href={`/benefits/${raffle.benefitId}?locale=${locale}` as Route}>{t.raffleView}<ArrowRight/></Link></div>
        : <div className={styles.raffleEmpty}><p>{t.raffleEmpty}</p></div>}
      <p className={styles.raffleHelp}>{t.raffleHelp}</p>
    </FanSurface>
  </div>;
}

export function scheduleRaffleBoundary(
  raffles: Parameters<typeof nextRaffleBoundary>[0],
  now: number,
  onBoundary: () => void,
  onOpen: () => void,
) {
  const nextBoundary = nextRaffleBoundary(raffles, now);
  if (!nextBoundary) return undefined;
  return window.setTimeout(() => { onBoundary(); if (nextBoundary.opens) onOpen(); }, Math.min(nextBoundary.at - now + 1, 2_147_483_647));
}

function FanGrade({ creator, locale }: { creator: PassportCreator; locale: FanLocale }) {
  const t = copy[locale];
  const progress = fanTierProgress(creator.passport);
  const stage = creator.passport.stageProgress;
  const currentLabel = stage ? fanStageLabel(locale, stage.current) : levelLabel(locale, creator.passport.tier);
  return <div className={styles.fanGrade}>
    <div className={styles.gradeIdentity}><FanTierBadge tier={creator.passport.tier} stageKey={stage?.current.key} locale={locale} size={88}/><div><span>{creator.celebrity.name}</span><strong>{currentLabel}</strong><p>{t.tierHelp}</p></div></div>
    <div className={styles.tierScore}><div><span>{locale === "ko" ? "팬 점수" : "Fan Score"}</span><strong>{creator.passport.score}{stage?.next ? ` / ${stage.next.minimumScore}` : !stage && progress.nextThreshold !== null ? ` / ${progress.nextThreshold}` : ""}{locale === "ko" ? "점" : ""}</strong></div><progress value={stage?.progressPercent ?? progress.percent} max={100} aria-label={locale === "ko" ? "다음 팬등급 진행률" : "Progress to next fan tier"}>{stage?.progressPercent ?? progress.percent}%</progress><div><span>{currentLabel}</span><strong>{stage ? stage.next ? (locale === "ko" ? `${fanStageLabel(locale, stage.next)}까지 ${stage.remaining}점` : `${stage.remaining} points to ${fanStageLabel(locale, stage.next)}`) : t.highestTier : progress.maxed ? t.highestTier : locale === "ko" ? `${levelLabel(locale, progress.nextTier)}까지 ${progress.remaining}점` : `${progress.remaining} points to ${levelLabel(locale, progress.nextTier)}`}</strong></div>{stage && stage.next?.tier === stage.current.tier && !progress.maxed ? <p className={styles.majorGoal}>{locale === "ko" ? `${levelLabel(locale, progress.nextTier)} 등급까지 ${progress.remaining}점` : `${progress.remaining} points to ${levelLabel(locale, progress.nextTier)}`}</p> : null}</div>
  </div>;
}

function formatClosing(value: string, locale: FanLocale) {
  return `${new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value))} ${locale === "ko" ? "마감" : "KST"}`;
}

function RecentActivityRows({ items, locale }: { items: MySummary["collection"]["recent"]; locale: FanLocale }) {
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
  return <div className={styles.rows}>{items.map((item) =>
    <Link href={`${item.href}?locale=${locale}` as Route} key={`${item.kind}-${item.id}`}><span className={styles.activityMark} data-kind={item.kind} aria-hidden="true">{item.kind === "stamp" ? <Sparkles/> : <FanMotionIcon name="gift" size={20}/>}</span><div><strong>{item.title}</strong><span>{formatDate(item.occurredAt)}</span></div><ArrowRight/></Link>)}</div>;
}

function Stat({ icon, value, label, href, kind, onClick }: { icon: ReactNode; value: number; label: string; href?: string; kind: "favorite" | "passport" | "stamp" | "ticket" | "collectible"; onClick?: () => void }) {
  const content = <><div className={styles.statIcon} aria-hidden="true">{icon}</div><strong>{value}</strong><span>{label}</span></>;
  return href ? <Link className={styles.stat} data-kind={kind} href={href as Route} onClick={onClick}>{content}</Link> : <div className={styles.stat} data-kind={kind}>{content}</div>;
}

function SectionTitle({ title, help, href, action }: { title: string; help?: string; href?: string; action?: string }) {
  return <FanSectionHeader variant="personal" title={title} description={help} accessory={href && action ? <Link href={href as Route}>{action}<ArrowRight/></Link> : null} />;
}

function Empty({ text, href, action }: { text: string; href: string; action: string }) {
  return <div className={styles.empty}><span>{text}</span><Link href={href as Route}>{action}<ArrowRight/></Link></div>;
}

/** Only the server-provided reserved collection is eligible; never promote public LIVE here. */
export function prioritizeReservedLives(events: MySummary["live"]["upcoming"]) {
  return events.filter(event => event.effectiveStatus === "live" || event.effectiveStatus === "scheduled")
    .toSorted((a,b) => Number(b.effectiveStatus === "live") - Number(a.effectiveStatus === "live") || Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}
export function passportProgressLabel(passport: NonNullable<MySummary["creators"][number]["passport"]>, locale: FanLocale) {
  const next = FAN_TIERS[FAN_TIERS.indexOf(passport.tier) + 1];
  const current = `${levelLabel(locale, passport.tier)} · ${locale === "ko" ? "팬 점수" : "Fan Score"} ${passport.score}`;
  return `${current} · ${next ? (locale === "ko" ? `${levelLabel(locale,next)}까지 팬 점수 ${passport.remainingToNextTier}점` : `${passport.remainingToNextTier} points to ${levelLabel(locale,next)}`) : (locale === "ko" ? "최고 등급" : "Highest tier")}`;
}

function ReservedLiveSection({events,history,locale,onStartReached}:{events:MySummary["live"]["upcoming"];history:MySummary["live"]["history"];locale:FanLocale;onStartReached:()=>void}) {
 const t=copy[locale];
 const [otherOpen,setOtherOpen]=useState(false);
 const formatDate=(value:string)=>new Intl.DateTimeFormat(locale==="ko"?"ko-KR":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Seoul"}).format(new Date(value));
 const row=(event:MySummary["live"]["upcoming"][number],active=true)=><Link href={`/live/${event.slug}?locale=${locale}` as Route} key={event.id}><time className={styles.liveDate} dateTime={event.startsAt}><span>{new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month:"short", timeZone:"Asia/Seoul" }).format(new Date(event.startsAt))}</span><b>{new Intl.DateTimeFormat("en-US", { day:"numeric", timeZone:"Asia/Seoul" }).format(new Date(event.startsAt))}</b></time><div><strong>{event.title}</strong><span>{formatDate(event.startsAt)} KST</span><MyLiveCountdown event={event} locale={locale} active={active} onStartReached={onStartReached}/></div><ArrowRight/></Link>;
 return <FanSurface appearance="plain" className={styles.section} aria-label={t.live}>
  <SectionTitle title={t.live} href={`/live?locale=${locale}`} action={t.allLive}/>
  {events.length?<div className={`${styles.rows} ${styles.reservedRows}`}>{row(events[0])}</div>:<Empty text={t.noLive} href={`/live?locale=${locale}`} action={t.browseLive}/>}
  {events.length>1?<details className={styles.history} open={otherOpen} onToggle={event=>setOtherOpen(event.currentTarget.open)}><summary>{locale==="ko"?"다른 예약 LIVE":"Other reserved LIVE"} ({events.length-1})</summary><div className={`${styles.rows} ${styles.reservedRows}`}>{events.slice(1).map(event=>row(event,otherOpen))}</div></details>:null}
  {history.length>0?<details className={styles.history}><summary>{t.history} ({history.length})</summary>{history.map(event=><Link href={`/live/${event.slug}?locale=${locale}` as Route} key={event.id}>{event.title}<span>{formatDate(event.startsAt)}</span></Link>)}</details>:null}
 </FanSurface>;
}
