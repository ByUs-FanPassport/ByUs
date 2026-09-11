"use client";
import { EventPhoto } from "@/components/fan-ui/event-photo";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, MessageSquare, Radio, Ticket } from "lucide-react";
import { z } from "zod";
import { flattenLiveCatalog } from "../domain/live-catalog";
import { raffleListSchema } from "@/features/benefit/domain/raffle";
import { creatorRaffleHref, creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";
import { bypassImageOptimization } from "@/components/fan-ui/public-image-policy";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "@/server/content/content-domain";
import { NoticeComments } from "./notice-comments";
import { useFanpageResource } from "./use-fanpage-resource";
import styles from "./fanpage.module.css";
import panels from "./home-panels.module.css";
import { ifewEventBanner } from "@/components/ifew-fan-guide/content";
import { ifewLiveSlug } from "@/features/live/domain/ifew-event";

const noticeListSchema = z.object({ notices: z.array(z.object({ slug: z.string(), title: z.string(), pinned: z.boolean(), kind: z.enum(["standard", "welcome"]).default("standard"), publishedAt: z.string() })) });
const parseNotices = (body: unknown) => noticeListSchema.parse(body).notices;
const parseRaffles = (body: unknown) => raffleListSchema.parse(body).raffles;
const formatDate = (date: string, locale: ContentLocale) => new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(date));

export function ResourceMessage({ locale, error, retry }: { locale: ContentLocale; error: boolean; retry: () => void }) {
  return <div className={styles.empty} role={error ? "alert" : "status"}><p>{locale === "ko" ? (error ? "불러오지 못했어요. 다시 시도해 주세요." : "불러오고 있어요.") : (error ? "Couldn't load this. Please try again." : "Loading.")}</p>{error && <button className={styles.pillButton} onClick={retry}>{locale === "ko" ? "다시 시도" : "Retry"}</button>}</div>;
}
export function RecentLive({ celebrity, locale, upcomingLive }: { celebrity: PublishedCelebrity; locale: ContentLocale; upcomingLive: PublishedCelebrityLive | null }) {
  const ko = locale === "ko";
  const registeredPoster = upcomingLive?.photos?.poster;
  const previewPoster = upcomingLive?.preview?.square.posterUrl;
  // An explicit CMS removal must never restore historical event artwork.
  const fallbackPoster = upcomingLive?.slug === ifewLiveSlug && registeredPoster !== null ? ifewEventBanner : null;
  const poster = registeredPoster?.asset.url ?? fallbackPoster;
  const hasArtwork = Boolean(previewPoster || poster);
  return (
    <section>
      <div className={styles.sectionHeading}>
        <h2>{ko ? "최근 활동" : "Recent activity"}</h2>
        <Link href={`/live?locale=${locale}`}>{ko ? "LIVE 전체 보기" : "All LIVE"}<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      {upcomingLive ? (
        <Link className={panels.liveCard} data-has-artwork={hasArtwork} href={`/live/${upcomingLive.slug}?locale=${locale}`}>
          {hasArtwork ? <div className={panels.liveMedia}>
            {previewPoster ? <Image src={previewPoster} alt="" fill sizes="(max-width:767px) calc(100vw - 32px), 320px" unoptimized={bypassImageOptimization(previewPoster)} />
              : <EventPhoto photos={upcomingLive.photos} src={poster!} alt={registeredPoster?.alt[locale] ?? upcomingLive.title} locale={locale} surface="poster" sizes="(max-width:767px) calc(100vw - 32px), 320px" />}
          </div> : null}
          <div className={panels.liveBody}>
            <span className={panels.liveStatus} data-live={upcomingLive.effectiveStatus === "live"}><Radio size={15} aria-hidden="true" />{upcomingLive.effectiveStatus === "live" ? "LIVE NOW" : (ko ? "다가오는 LIVE" : "Upcoming LIVE")}</span>
            <h3>{upcomingLive.title}</h3>
            <p className={panels.liveDate}><CalendarDays size={16} aria-hidden="true" /><time dateTime={upcomingLive.startsAt}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(new Date(upcomingLive.startsAt))} (KST)</time></p>
            <span className={panels.liveAction}>{ko ? "LIVE 자세히 보기" : "View LIVE details"}<ArrowRight size={16} aria-hidden="true" /></span>
          </div>
        </Link>
      ) : <div className={panels.emptyState}>
        <span className={panels.emptyIcon}><Radio aria-hidden="true" /></span>
        <div><h3>{ko ? "새로운 활동을 기다리고 있어요." : "New moments are on the way."}</h3><p>{ko ? `${celebrity.name}의 새 소식과 LIVE가 공개되면 이곳에서 만나요.` : `See ${celebrity.name}'s updates and LIVE events here when published.`}</p></div>
      </div>}
    </section>
  );
}
export function NoticePanel({ slug, locale, full = false }: { slug: string; locale: ContentLocale; full?: boolean }) {
  const ko = locale === "ko";
  const resource = useFanpageResource(`/api/public/celebrities/${slug}/notices?locale=${locale}${full ? "" : "&surface=home"}`, parseNotices);
  const empty = resource.state.status === "ready" && resource.state.data.length === 0;
  return (
    <section className={panels.notices}>
      <div className={styles.sectionHeading}>
        <h2>{ko ? "공지와 댓글" : "Notices & comments"}</h2>
        {!full && !empty && <Link href={`/c/${slug}?tab=notice&locale=${locale}#celebrity-content`}>{ko ? "공지 전체 보기" : "All notices"}<ArrowRight size={16} aria-hidden="true" /></Link>}
      </div>
      {resource.state.status !== "ready" ? <div className={panels.noticeFeedback}><ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /></div>
        : empty ? <div className={panels.emptyState} role="status">
          <span className={panels.emptyIcon}><MessageSquare aria-hidden="true" /></span>
          <div><h3>{ko ? "아직 등록된 공지가 없어요." : "No notices yet."}</h3><p>{ko ? "새 소식이 올라오면 여기에서 확인할 수 있어요." : "New updates will appear here."}</p></div>
        </div>
        : resource.state.data.slice(0, full ? undefined : 1).map((notice) => <article key={notice.slug} className={`${styles.notice} ${panels.noticeItem}`}>
          <Link className={panels.noticeLink} href={`/c/${slug}/notices/${notice.slug}?locale=${locale}`}>
            <div><h3>{notice.pinned && <span className={styles.pinned}>{notice.kind === "welcome" ? (ko ? "이용 안내" : "Start here") : (ko ? "공지" : "Notice")}</span>}{notice.title}</h3><time dateTime={notice.publishedAt}>{formatDate(notice.publishedAt, locale)}</time></div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          {!full && <NoticeComments slug={slug} noticeSlug={notice.slug} locale={locale} welcome={notice.kind === "welcome"} preview />}
        </article>)}
    </section>
  );
}
export function RafflePanel({ slug, name, locale, preview = false, ticketBalance }: { slug: string; name: string; locale: ContentLocale; preview?: boolean; ticketBalance: number | null }) {
  const ko = locale === "ko";
  const resource = useFanpageResource(`/api/celebrities/${slug}/raffles?locale=${locale}`, parseRaffles);
  const statusText = { preparing: ko ? "이벤트 준비 중" : "Preparing", open: ko ? "응모 진행 중" : "Entries open", closed: ko ? "응모 종료" : "Closed", cancelled: ko ? "운영 취소 · 응모권 반환" : "Cancelled · tickets refunded" };
  return <section><div className={styles.sectionHeading}><h2>{ko ? "래플 응모" : "Raffles"}</h2>{preview && <Link href={creatorRafflesHref(slug, locale)}>{ko ? "전체 래플 보기" : "All raffles"} →</Link>}</div>{!preview && <p className={styles.intro}>{ko ? `${name} 응모권으로 원하는 경품에 직접 응모하세요.` : `Choose a prize and enter using your ${name} raffle tickets.`}</p>}
    {resource.state.status !== "ready" ? <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /> : !resource.state.data.length ? <div className={styles.empty}><Ticket aria-hidden="true" /><h3>{ko ? "새 래플을 준비하고 있어요." : "New raffles are coming."}</h3><p>{ko ? "경품과 일정이 공개되면 이곳에서 확인해 주세요." : "Check here for prizes and entry dates."}</p></div> : <div className={preview ? styles.featuredRaffle : styles.raffleGrid}>{resource.state.data.slice(0, preview ? 1 : undefined).map((raffle) => <article className={styles.raffleCard} key={raffle.id} data-status={raffle.status}>
      <div className={styles.raffleImage}>{raffle.imageUrl ? <Image src={raffle.imageUrl} alt="" fill sizes={preview ? "(min-width:768px) 280px, calc(100vw - 64px)" : "(min-width:768px) 400px, calc(100vw - 64px)"} unoptimized={bypassImageOptimization(raffle.imageUrl)} /> : <><Ticket aria-hidden="true" /><span>{ko ? "경품 안내" : "Prize"}</span></>}</div>
      <div className={styles.raffleBody}><span className={styles.statusPill}>{statusText[raffle.status]}</span><h3>{raffle.title}</h3><p>{raffle.summary}</p><p>{ko ? `${raffle.winnerQuantity}명 추첨` : `${raffle.winnerQuantity} winners`}</p>{raffle.entryClosesAt && <small>{formatDate(raffle.entryClosesAt, locale)} {ko ? "마감" : "deadline"}</small>}
        <div className={styles.ticketBalance}><Ticket aria-hidden="true" />{ticketBalance !== null ? (ko ? `내 ${name} 응모권 ${ticketBalance}장` : `${ticketBalance} ${name} tickets`) : (ko ? "로그인하고 내 응모권 확인" : "Sign in to check your tickets")}</div>
        {raffle.benefitId && raffle.status !== "preparing" ? <Link className={styles.darkButton} href={creatorRaffleHref(slug, raffle.benefitId, locale)}>{ko ? "래플 자세히 보기" : "View raffle"}<ArrowRight aria-hidden="true" /></Link> : <p className={styles.preparing}>{ko ? "응모 일정은 공지에서 안내해요." : "Entry dates will be announced in Notices."}</p>}
      </div>
    </article>)}</div>}
  </section>;
}

const parseLiveCatalog = (body: unknown) => flattenLiveCatalog((body as { catalog: unknown }).catalog);
export function CreatorLivePanel({ slug, locale }: { slug: string; locale: ContentLocale }) {
  const resource = useFanpageResource(`/api/live-events?locale=${locale}`, parseLiveCatalog);
  const ko = locale === "ko";
  const events = resource.state.status === "ready" ? resource.state.data.filter(({ live }) => live.celebrity.slug === slug) : [];
  const statuses = { scheduled: ko ? "예정" : "Upcoming", live: "LIVE NOW", ended: ko ? "종료" : "Ended", cancelled: ko ? "취소" : "Cancelled" };
  return <section><div className={styles.sectionHeading}><h2>LIVE</h2></div>{resource.state.status !== "ready" ? <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /> : events.length === 0 ? <div className={styles.empty}>{ko ? "공개된 LIVE가 없어요." : "No published LIVE events."}</div> : events.map(({ live }) => <Link key={live.slug} className={styles.liveCard} href={`/live/${live.slug}?locale=${locale}`}><div className={styles.livePhoto}><EventPhoto src={live.heroImage.url} alt={live.heroImage.alt} photos={live.photos} locale={locale} surface="detail" sizes="(min-width:768px) 340px, calc(100vw - 64px)" /></div><div><span className={styles.eyebrow}>{statuses[live.effectiveStatus]}</span><h3>{live.title}</h3><p>{formatDate(live.startsAt, locale)}</p><span>{ko ? "LIVE 자세히 보기" : "View LIVE details"} →</span></div></Link>)}</section>;
}
