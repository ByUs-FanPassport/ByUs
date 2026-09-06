"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Bell, BookOpen, RotateCcw, Settings, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { type ReactNode } from "react";
import { useOwnedFanResource } from "../../../components/fan-ui/use-owned-fan-resource";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { GoogleMark } from "@/components/icons";
import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { fanActionClassName, FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { FanMotionIcon } from "@/components/fan-ui/fan-motion-icon";
import type { MyReward } from "../../benefit/domain/my-reward";
import { levelLabel } from "../../passport/domain/passport-read-model";
import { mySummarySchema, type MySummary } from "../domain/my-summary";
import { FanHeading, FanSectionHeader } from "../../../components/fan-ui/fan-heading";
import { FAN_TIERS } from "../../rewards/domain/reward-policy";
import { FanSurface, fanUtilityCanvasClassName } from "../../../components/fan-ui/fan-surface";
import { Avatar, AvatarPlaceholder } from "../../profile/ui/avatar";
import { useAvatar } from "../../profile/ui/use-avatar";
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
    notifications: "새 알림", settings: "알림 설정", tickets: "응모권", firstReaction: "첫 반응",
    avatarSettings: "프로필 이미지 변경",
    allLive: "전체 LIVE 보기", allRewards: "혜택 전체 보기",
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
    notifications: "New alerts", settings: "Notification settings", tickets: "Raffle tickets", firstReaction: "First Reaction",
    avatarSettings: "Change profile image",
    allLive: "View all LIVE", allRewards: "View all rewards",
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
  const resource = useOwnedFanResource(`/api/me/summary?locale=${locale}`, parseSummaryResponse, auth);
  const avatarResource = useAvatar();
  const state = resource.state;
  const t = copy[locale];

  const heading = <header className={styles.pageHeading}><FanHeading as="h1" variant="personal-page">{t.title}</FanHeading></header>;
  return <FanAppFrame locale={locale} className={fanUtilityCanvasClassName} mainId="my-content" currentPath="/my"><FanContentContainer as="main" className={styles.main} id="my-content" tabIndex={-1}>
    {!ready ? <>{heading}<FanState kind="loading" title={t.loading} /></>
      : !authenticated ? <>{heading}<section className={styles.guest}><BookOpen/><h2>{t.guestTitle}</h2><p>{t.guestBody}</p><AuthIntentLink className={fanActionClassName("service", { fullWidth: true })} locale={locale} input={{ sourcePath: "/my", sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" }}><GoogleMark/><span>{t.login}</span><ArrowRight/></AuthIntentLink></section></>
      : state.status === "loading" ? <>{heading}<FanState kind="loading" title={t.loading} /></>
      : state.status === "error" ? <>{heading}<FanState kind="error" title={t.error} actions={<FanAction variant="neutral" fullWidth onClick={resource.retry}><RotateCcw/>{t.retry}</FanAction>} /></>
      : <Dashboard summary={state.data} locale={locale} avatarResource={avatarResource}/>}
  </FanContentContainer></FanAppFrame>;
}

function Dashboard({ summary, locale, avatarResource }: { summary: MySummary; locale: FanLocale; avatarResource: ReturnType<typeof useAvatar> }) {
  const t = copy[locale];
  const nickname = summary.profile.nickname?.trim() || null;
  const identity = nickname ? (locale === "ko" ? `${nickname}님` : nickname) : t.profileSummary;
  const hasRewards = summary.rewards.items.length > 0 || summary.rewards.availableCount > 0 || summary.rewards.entries > 0;
  const reservedLives = prioritizeReservedLives(summary.live.upcoming);
  const hasRail = summary.collection.recent.length > 0 || hasRewards || (!reservedLives.length && summary.live.history.length > 0);
  const ticketBalance = summary.creators.reduce((total, creator) => total + creator.ticketBalance, 0);
  const visibleRecent = summary.collection.recent.slice(0, 3);
  const hasVisibleCollectible = visibleRecent.some((item) => item.kind === "collectible");
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));

  return <div className={styles.dashboard}>
    <header className={styles.profileHeader}>
      <Link className={styles.avatarLink} href={`/settings?locale=${locale}` as Route} aria-label={t.avatarSettings}>
        {avatarResource.state.status === "ready"
          ? <Avatar avatar={avatarResource.state.avatar} imageUrl={avatarResource.state.imageUrl} label={t.avatarSettings} size={64}/>
          : <AvatarPlaceholder size={64}/>}
      </Link>
      <div className={styles.profileCopy}><h1>{identity}</h1><p>{t.profileHelp}</p></div>
      <div className={styles.profileActions}>
        <Link className={styles.notificationLink} href={`/notifications?locale=${locale}` as Route}><Bell aria-hidden="true"/><span>{t.notifications}</span><strong>{summary.unreadNotificationCount}</strong></Link>
        <Link className={styles.notificationLink} href={`/settings?locale=${locale}` as Route}><Settings aria-hidden="true"/><span>{t.settings}</span></Link>
      </div>
    </header>



    <div className={styles.workspace} data-has-rail={hasRail}>
      <div className={styles.primaryColumn}>
        {reservedLives.length > 0 ? <ReservedLiveSection events={reservedLives} history={summary.live.history} locale={locale}/> : null}
        <FanSurface appearance="plain" className={styles.section} id="my-creators">
          <SectionTitle title={t.creators} href={`/celebrities?locale=${locale}`} action={t.findCreator}/>
          {summary.creators.length ? <div className={styles.creatorList}>{summary.creators.map((creator) =>
            <Link className={styles.creator} href={((creator.passport ? `/passports/${creator.passport.id}` : `/c/${creator.celebrity.slug}`) + `?locale=${locale}`) as Route} key={creator.celebrity.slug}>
              <Image src={creator.celebrity.image} alt="" width={192} height={240}/>
              <div><strong>{creator.celebrity.name}</strong><span>{creator.passport ? passportProgressLabel(creator.passport, locale) : t.firstReaction}</span><span><FanMotionIcon name="ticket" size={16} active/>{creator.ticketBalance} {t.tickets}</span></div><ArrowRight/>
            </Link>)}</div> : <Empty text={t.noCreators} href={`/celebrities?locale=${locale}`} action={t.findCreator}/>}
        </FanSurface>


      </div>

      {hasRail ? <aside className={styles.activityRail} aria-label={locale === "ko" ? "다가오는 활동과 혜택" : "Upcoming activity and rewards"}>
        {summary.collection.recent.length > 0 ? <FanSurface appearance="plain" className={styles.section} id="my-collection">
          <SectionTitle title={t.collection}/>

          {<div className={styles.rows}>{visibleRecent.map((item) =>
            <Link href={`${item.href}?locale=${locale}` as Route} key={`${item.kind}-${item.id}`}><span className={styles.activityMark} aria-hidden="true">{item.kind === "stamp" ? <Sparkles/> : <FanMotionIcon name="gift" size={20} active/>}</span><div><strong>{item.title}</strong><span>{formatDate(item.occurredAt)}</span></div><ArrowRight/></Link>)}</div>}
        </FanSurface> : null}
        {!reservedLives.length && summary.live.history.length > 0 ? <ReservedLiveSection events={reservedLives} history={summary.live.history} locale={locale}/> : null}


        {hasRewards ? <FanSurface appearance="plain" className={styles.section}>
          <SectionTitle title={t.rewards} href={`/benefits?locale=${locale}`} action={t.allRewards}/>
          <div className={styles.rewardMetrics}><Link href={`/benefits?locale=${locale}` as Route}><FanMotionIcon name="gift" size={20} active/><span>{t.available}</span><strong>{summary.rewards.availableCount}</strong></Link><div><FanMotionIcon name="ticket" size={20} active/><span>{t.entries}</span><strong>{summary.rewards.entries}</strong></div></div>
          {summary.rewards.items.length ? <div className={styles.rows}>{summary.rewards.items.slice(0, 4).map((reward) =>
            <Link href={`${reward.benefitHref}?locale=${locale}` as Route} key={reward.rewardResultId}><FanMotionIcon name="gift" size={20} active/><div><strong>{reward.title}</strong><span>{rewardStatusCopy[reward.status][locale]}</span></div><ArrowRight/></Link>)}</div>
            : <p className={styles.emptyText}>{t.noRewards}</p>}
        </FanSurface> : null}
      </aside> : null}
    </div>
    <section className={styles.overview} aria-labelledby="activity-overview-heading">
      <h2 id="activity-overview-heading">{t.overview}</h2>
      <div className={styles.overviewGrid}>
        <Stat icon={<Star/>} value={summary.creators.length} label={t.creators} href="#my-creators" kind="favorite"/>
        <Stat icon={<BookOpen/>} value={summary.collection.passportCount} label={t.passports} href={`/passports?locale=${locale}`} kind="passport"/>
        <Stat icon={<Sparkles/>} value={summary.collection.stampCount} label={t.stamps} href={`/passports?locale=${locale}#collection`} kind="stamp"/>
        <Stat icon={<FanMotionIcon name="ticket" size={20} active/>} value={ticketBalance} label={t.tickets} href="#my-creators" kind="ticket"/>
        <Stat icon={<FanMotionIcon name="gift" size={20} active/>} value={summary.collection.collectibleCount} label={t.collectibles} href={hasVisibleCollectible ? "#my-collection" : undefined} kind="collectible"/>
      </div>
    </section>
  </div>;
}

function Stat({ icon, value, label, href, kind }: { icon: ReactNode; value: number; label: string; href?: string; kind: "favorite" | "passport" | "stamp" | "ticket" | "collectible" }) {
  const content = <><div className={styles.statIcon} aria-hidden="true">{icon}</div><strong>{value}</strong><span>{label}</span></>;
  return href ? <Link className={styles.stat} data-kind={kind} href={href as Route}>{content}</Link> : <div className={styles.stat} data-kind={kind}>{content}</div>;
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

function ReservedLiveSection({events,history,locale}:{events:MySummary["live"]["upcoming"];history:MySummary["live"]["history"];locale:FanLocale}) {
 const t=copy[locale];
 const formatDate=(value:string)=>new Intl.DateTimeFormat(locale==="ko"?"ko-KR":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Seoul"}).format(new Date(value));
 const row=(event:MySummary["live"]["upcoming"][number])=><Link href={`/live/${event.slug}?locale=${locale}` as Route} key={event.id}><time className={styles.liveDate} dateTime={event.startsAt}><span>{new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month:"short", timeZone:"Asia/Seoul" }).format(new Date(event.startsAt))}</span><b>{new Intl.DateTimeFormat("en-US", { day:"numeric", timeZone:"Asia/Seoul" }).format(new Date(event.startsAt))}</b></time><div><strong>{event.title}</strong><span>{event.effectiveStatus==="live"?(locale==="ko"?"진행 중 · 예약 완료":"Live now · Reserved"):t.upcoming} · {formatDate(event.startsAt)} KST</span></div><ArrowRight/></Link>;
 return <FanSurface appearance="plain" className={styles.section} aria-label={t.live}>
  <SectionTitle title={t.live} href={`/live?locale=${locale}`} action={t.allLive}/>
  {events.length?<div className={`${styles.rows} ${styles.reservedRows}`}>{row(events[0])}</div>:<Empty text={t.noLive} href={`/live?locale=${locale}`} action={t.browseLive}/>}
  {events.length>1?<details className={styles.history}><summary>{locale==="ko"?"다른 예약 LIVE":"Other reserved LIVE"} ({events.length-1})</summary><div className={`${styles.rows} ${styles.reservedRows}`}>{events.slice(1).map(row)}</div></details>:null}
  {history.length>0?<details className={styles.history}><summary>{t.history} ({history.length})</summary>{history.map(event=><Link href={`/live/${event.slug}?locale=${locale}` as Route} key={event.id}>{event.title}<span>{formatDate(event.startsAt)}</span></Link>)}</details>:null}
 </FanSurface>;
}
