"use client";

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__home-panels";
import { translate } from "@/i18n/messages";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

import { EventPhoto } from "@/components/fan-ui/event-photo";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, MessageSquare, Radio, Ticket } from "lucide-react";
import { z } from "zod";
import { flattenLiveCatalog } from "../domain/live-catalog";
import { raffleListSchema, raffleStatus } from "@/features/benefit/domain/raffle";
import { creatorRaffleHref } from "@/features/benefit/domain/raffle-navigation";
import { RaffleArtwork } from "@/features/benefit/ui/raffle-artwork";
import { formatRaffleDateTime } from "@/features/benefit/ui/benefit-presentation";
import { FAN_TICKET_CREATOR_SLUGS } from "@/features/tickets/domain/fan-ticket-activity";
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
const formatDate = (date: string, locale: AppLocale) => new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(date));

export function ResourceMessage({ locale, error, retry }: { locale: AppLocale; error: boolean; retry: () => void }) {
  return <div className={styles.empty} role={error ? "alert" : "status"}><p>{locale === "ko" ? (error ? "불러오지 못했어요. 다시 시도해 주세요." : "불러오고 있어요.") : (error ? translate(locale, localizedMessages.m5347ac7955c6, "Couldn't load this. Please try again.") : translate(locale, localizedMessages.m7610a2b6d58f, "Loading."))}</p>{error && <button className={styles.pillButton} onClick={retry}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m3875a5d69dbe, "Retry")}</button>}</div>;
}
export function RecentLive({ celebrity, locale, upcomingLive }: { celebrity: PublishedCelebrity; locale: AppLocale; upcomingLive: PublishedCelebrityLive | null }) {
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
        <h2>{locale === "ko" ? "최근 활동" : translate(locale, localizedMessages.m43693f52f548, "Recent activity")}</h2>
        <Link href={`/live?locale=${locale}`}>{locale === "ko" ? "LIVE 전체 보기" : translate(locale, localizedMessages.m1b1bd5b9acd8, "All LIVE")}<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      {upcomingLive ? (
        <Link className={panels.liveCard} data-has-artwork={hasArtwork} href={`/live/${upcomingLive.slug}?locale=${locale}`}>
          {hasArtwork ? <div className={panels.liveMedia}>
            {previewPoster ? <Image src={previewPoster} alt="" fill sizes="(max-width:767px) calc(100vw - 32px), 320px" unoptimized={bypassImageOptimization(previewPoster)} />
              : <EventPhoto photos={upcomingLive.photos} src={poster!} alt={registeredPoster?.alt[toContentLocale(locale)] ?? upcomingLive.title} locale={locale} surface="poster" sizes="(max-width:767px) calc(100vw - 32px), 320px" />}
          </div> : null}
          <div className={panels.liveBody}>
            <span className={panels.liveStatus} data-live={upcomingLive.effectiveStatus === "live"}><Radio size={15} aria-hidden="true" />{upcomingLive.effectiveStatus === "live" ? "LIVE NOW" : (locale === "ko" ? "다가오는 LIVE" : translate(locale, localizedMessages.mc4b0cb6efc48, "Upcoming LIVE"))}</span>
            <h3>{upcomingLive.title}</h3>
            <p className={panels.liveDate}><CalendarDays size={16} aria-hidden="true" /><time dateTime={upcomingLive.startsAt}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(new Date(upcomingLive.startsAt))} (KST)</time></p>
            <span className={panels.liveAction}>{locale === "ko" ? "LIVE 자세히 보기" : translate(locale, localizedMessages.me8e3a9e42c78, "View LIVE details")}<ArrowRight size={16} aria-hidden="true" /></span>
          </div>
        </Link>
      ) : <div className={panels.emptyState}>
        <span className={panels.emptyIcon}><Radio aria-hidden="true" /></span>
        <div><h3>{locale === "ko" ? "새로운 활동을 기다리고 있어요." : translate(locale, localizedMessages.m541de64fb9bb, "New moments are on the way.")}</h3><p>{locale === "ko" ? `${celebrity.name}의 새 소식과 LIVE가 공개되면 이곳에서 만나요.` : translate(locale, localizedMessages.m1023187bedc3, "See {0}'s updates and LIVE events here when published.", [celebrity.name])}</p></div>
      </div>}
    </section>
  );
}
export function NoticePanel({ slug, locale, full = false }: { slug: string; locale: AppLocale; full?: boolean }) {
  const ko = locale === "ko";
  const resource = useFanpageResource(`/api/public/celebrities/${slug}/notices?locale=${toContentLocale(locale)}${full ? "" : "&surface=home"}`, parseNotices);
  const empty = resource.state.status === "ready" && resource.state.data.length === 0;
  return (
    <section className={panels.notices}>
      <div className={styles.sectionHeading}>
        <h2>{locale === "ko" ? "공지와 댓글" : translate(locale, localizedMessages.mc06551416571, "Notices & comments")}</h2>
        {!full && !empty && <Link href={`${creatorHomeHref(slug)}?tab=notice&locale=${locale}#celebrity-content`}>{locale === "ko" ? "공지 전체 보기" : translate(locale, localizedMessages.m8d2e50846134, "All notices")}<ArrowRight size={16} aria-hidden="true" /></Link>}
      </div>
      {resource.state.status !== "ready" ? <div className={panels.noticeFeedback}><ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /></div>
        : empty ? <div className={panels.emptyState} role="status">
          <span className={panels.emptyIcon}><MessageSquare aria-hidden="true" /></span>
          <div><h3>{locale === "ko" ? "아직 등록된 공지가 없어요." : translate(locale, localizedMessages.m3f185398b16f, "No notices yet.")}</h3><p>{locale === "ko" ? "새 소식이 올라오면 여기에서 확인할 수 있어요." : translate(locale, localizedMessages.m694c52137a91, "New updates will appear here.")}</p></div>
        </div>
        : resource.state.data.slice(0, full ? undefined : 1).map((notice) => <article key={notice.slug} className={`${styles.notice} ${panels.noticeItem}`}>
          <Link className={panels.noticeLink} href={`/c/${slug}/notices/${notice.slug}?locale=${locale}`}>
            <div><h3>{notice.pinned && <span className={styles.pinned}>{notice.kind === "welcome" ? (locale === "ko" ? "이용 안내" : translate(locale, localizedMessages.m950773a69f9d, "Start here")) : (locale === "ko" ? "공지" : translate(locale, localizedMessages.mdd3b38ddd8aa, "Notice"))}</span>}{notice.title}</h3><time dateTime={notice.publishedAt}>{formatDate(notice.publishedAt, locale)}</time></div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          {!full && <NoticeComments slug={slug} noticeSlug={notice.slug} locale={locale} welcome={notice.kind === "welcome"} preview />}
        </article>)}
    </section>
  );
}
export function useCreatorRaffles(slug: string, locale: AppLocale) {
  const resource = useFanpageResource(`/api/celebrities/${slug}/raffles?locale=${toContentLocale(locale)}`, parseRaffles);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const available = resource.state.status === "ready"
    ? resource.state.data.filter(raffle => raffle.benefitId && raffleStatus(raffle, now) === "open") : [];
  return { ...resource, available };
}

export function RafflePanel({ slug, name, locale, preview = false, ticketBalance, resource }: { slug: string; name: string; locale: AppLocale; preview?: boolean; ticketBalance: number | null; resource: ReturnType<typeof useCreatorRaffles> }) {
  const ko = locale === "ko";
  if (preview) {
    const gifts = resource.available;
    const deadline = gifts[0]?.entryClosesAt;
    const sharedDeadline = deadline && gifts.every(gift => gift.entryClosesAt && Date.parse(gift.entryClosesAt) === Date.parse(deadline)) ? deadline : null;
    const closingTime = (date: string) => <time className={styles.homeDeadline} dateTime={date}>{formatRaffleDateTime(date, locale)} {locale === "ko" ? "마감" : translate(locale, localizedMessages.mcf133f000b89, "closes")}</time>;
    return <section className={styles.homeRaffles} aria-labelledby="home-raffle-heading">
      <div className={styles.homeRaffleHeading}>
        <div className={styles.homeRaffleTitle}><h2 id="home-raffle-heading">{locale === "ko" ? "응모 가능한 선물" : translate(locale, localizedMessages.ma9d3b3913311, "Gifts you can enter")}{" "}{resource.state.status === "ready" && <span>{gifts.length}</span>}</h2>{sharedDeadline && closingTime(sharedDeadline)}</div>
        <div className={styles.raffleWallet}>
          {ticketBalance !== null && <span><Ticket aria-hidden="true" />{locale === "ko" ? `보유 응모권 ${ticketBalance.toLocaleString("ko-KR")}장` : translate(locale, localizedMessages.m751e3b484d1e, "{0} tickets", [ticketBalance.toLocaleString("en-US")])}</span>}
          {FAN_TICKET_CREATOR_SLUGS.has(slug) && <Link href={`/c/${slug}/tickets?locale=${locale}`}>{locale === "ko" ? "응모권 모으기" : translate(locale, localizedMessages.m309e1c640be3, "Collect tickets")}<ArrowRight aria-hidden="true" /></Link>}
        </div>
      </div>
      {resource.state.status !== "ready" ? <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /> : !gifts.length ? <div className={styles.empty}>{locale === "ko" ? "지금 응모할 수 있는 선물이 없어요." : translate(locale, localizedMessages.m30e5b230c66c, "No gifts are open for entry right now.")}</div> : <div className={styles.homeGiftGrid}>
        {gifts.map(raffle => <article className={styles.homeGiftCard} key={raffle.id}>
          <RaffleArtwork raffle={raffle} compact />
          <div className={styles.homeGiftBody}><strong className={styles.homeGiftWinners}>{locale === "ko" ? `${raffle.winnerQuantity}명 추첨` : translate(locale, localizedMessages.me9dda1227b55, "{0} winners", [raffle.winnerQuantity])}</strong><h3>{raffle.title}</h3>
            {!sharedDeadline && raffle.entryClosesAt && closingTime(raffle.entryClosesAt)}
            <Link className={styles.darkButton} href={creatorRaffleHref(slug, raffle.benefitId!, locale)} aria-label={locale === "ko" ? `${raffle.title} 응모하기` : translate(locale, localizedMessages.m694bc6806f76, "Enter for {0}", [raffle.title])}>{locale === "ko" ? "응모하기" : translate(locale, localizedMessages.m32172c4b3182, "Enter raffle")}<ArrowRight aria-hidden="true" /></Link>
          </div>
        </article>)}
      </div>}
    </section>;
  }
  const statusText = { preparing: locale === "ko" ? "이벤트 준비 중" : translate(locale, localizedMessages.madd088ed5150, "Preparing"), open: locale === "ko" ? "응모 진행 중" : translate(locale, localizedMessages.mc65ed9ce7fd1, "Entries open"), closed: locale === "ko" ? "응모 종료" : translate(locale, localizedMessages.mc1eb21f2eb4b, "Closed"), cancelled: locale === "ko" ? "운영 취소 · 응모권 반환" : translate(locale, localizedMessages.m777ad91ea4a1, "Cancelled · tickets refunded") };
  return <section><div className={styles.sectionHeading}><h2>{locale === "ko" ? "래플 응모" : translate(locale, localizedMessages.m04101d7a69c9, "Raffles")}</h2></div>{!preview && <p className={styles.intro}>{locale === "ko" ? `${name} 응모권으로 원하는 경품에 직접 응모하세요.` : translate(locale, localizedMessages.m08fd986b3ebe, "Choose a prize and enter using your {0} raffle tickets.", [name])}</p>}
    {resource.state.status !== "ready" ? <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /> : !resource.state.data.length ? <div className={styles.empty}><Ticket aria-hidden="true" /><h3>{locale === "ko" ? "새 래플을 준비하고 있어요." : translate(locale, localizedMessages.m659677f29a05, "New raffles are coming.")}</h3><p>{locale === "ko" ? "경품과 일정이 공개되면 이곳에서 확인해 주세요." : translate(locale, localizedMessages.md966c9e04263, "Check here for prizes and entry dates.")}</p></div> : <div className={preview ? styles.featuredRaffle : styles.raffleGrid}>{resource.state.data.map((raffle) => <article className={styles.raffleCard} key={raffle.id} data-status={raffle.status}>
      <div className={styles.raffleImage}>{raffle.imageUrl ? <Image src={raffle.imageUrl} alt="" fill sizes={preview ? "(min-width:768px) 280px, calc(100vw - 64px)" : "(min-width:768px) 400px, calc(100vw - 64px)"} unoptimized={bypassImageOptimization(raffle.imageUrl)} /> : <><Ticket aria-hidden="true" /><span>{locale === "ko" ? "경품 안내" : translate(locale, localizedMessages.m252d38eed9f1, "Prize")}</span></>}</div>
      <div className={styles.raffleBody}><span className={styles.statusPill}>{statusText[raffle.status]}</span><h3>{raffle.title}</h3><p>{raffle.summary}</p><p>{locale === "ko" ? `${raffle.winnerQuantity}명 추첨` : translate(locale, localizedMessages.me9dda1227b55, "{0} winners", [raffle.winnerQuantity])}</p>{raffle.entryClosesAt && <small>{formatDate(raffle.entryClosesAt, locale)} {locale === "ko" ? "마감" : translate(locale, localizedMessages.md728bb30f99d, "deadline")}</small>}
        <div className={styles.ticketBalance}><Ticket aria-hidden="true" />{ticketBalance !== null ? (locale === "ko" ? `내 ${name} 응모권 ${ticketBalance}장` : translate(locale, localizedMessages.mbac879409dfb, "{0} {1} tickets", [ticketBalance, name])) : (locale === "ko" ? "로그인하고 내 응모권 확인" : translate(locale, localizedMessages.mc4f406571c84, "Sign in to check your tickets"))}</div>
        {raffle.benefitId && raffle.status !== "preparing" ? <Link className={styles.darkButton} href={creatorRaffleHref(slug, raffle.benefitId, locale)}>{locale === "ko" ? "래플 자세히 보기" : translate(locale, localizedMessages.mc5325fdf82cf, "View raffle")}<ArrowRight aria-hidden="true" /></Link> : <p className={styles.preparing}>{locale === "ko" ? "응모 일정은 공지에서 안내해요." : translate(locale, localizedMessages.m1d0239729880, "Entry dates will be announced in Notices.")}</p>}
      </div>
    </article>)}</div>}
  </section>;
}

const parseLiveCatalog = (body: unknown) => flattenLiveCatalog((body as { catalog: unknown }).catalog);
export function CreatorLivePanel({ slug, locale }: { slug: string; locale: AppLocale }) {
  const resource = useFanpageResource(`/api/live-events?locale=${toContentLocale(locale)}`, parseLiveCatalog);
  const ko = locale === "ko";
  const events = resource.state.status === "ready" ? resource.state.data.filter(({ live }) => live.celebrity.slug === slug) : [];
  const statuses = { scheduled: locale === "ko" ? "예정" : translate(locale, localizedMessages.m1e4f7badba7d, "Upcoming"), live: "LIVE NOW", ended: locale === "ko" ? "종료" : translate(locale, localizedMessages.ma25956083eb2, "Ended"), cancelled: locale === "ko" ? "취소" : translate(locale, localizedMessages.me70ae1625f95, "Cancelled") };
  return <section><div className={styles.sectionHeading}><h2>LIVE</h2></div>{resource.state.status !== "ready" ? <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} /> : events.length === 0 ? <div className={styles.empty}>{locale === "ko" ? "공개된 LIVE가 없어요." : translate(locale, localizedMessages.m48a9cea28333, "No published LIVE events.")}</div> : events.map(({ live }) => <Link key={live.slug} className={styles.liveCard} href={`/live/${live.slug}?locale=${locale}`}><div className={styles.livePhoto}><EventPhoto src={live.heroImage.url} alt={live.heroImage.alt} photos={live.photos} locale={locale} surface="detail" sizes="(min-width:768px) 340px, calc(100vw - 64px)" /></div><div><span className={styles.eyebrow}>{statuses[live.effectiveStatus]}</span><h3>{live.title}</h3><p>{formatDate(live.startsAt, locale)}</p><span>{locale === "ko" ? "LIVE 자세히 보기" : translate(locale, localizedMessages.me8e3a9e42c78, "View LIVE details")} →</span></div></Link>)}</section>;
}
