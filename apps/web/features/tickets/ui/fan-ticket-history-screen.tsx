"use client";

import { toContentLocale } from "@/i18n/locales";
import { type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__tickets__ui__fan-ticket-history-screen";
import { additionalLocales, translate } from "@/i18n/messages";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, RotateCcw, Ticket } from "lucide-react";
import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useByUsSession } from "@/components/byus-session-provider";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { parseFanTicketActivity, type FanTicketActivity } from "../domain/fan-ticket-activity";
import { FanTicketGuide } from "./fan-ticket-guide";
import styles from "./fan-ticket-history-screen.module.css";

const sourceNames: Record<string, Record<AppLocale, string>> = {
  verification: { ko: "팬 인증", en: "Fan verification" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m9136c3390dcd[translationLocale]))
}, reaction: { ko: "좋아요", en: "Like" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m4eac19a07001[translationLocale]))
}, comment: { ko: "첫 댓글", en: "First comment" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m6aa11d1da6c4[translationLocale]))
}, checkin: { ko: "데일리 출석", en: "Daily check-in" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m32e73ae25e28[translationLocale]))
},
  membership_instagram: { ko: "Instagram 멤버십 인증", en: "Instagram membership" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m539b6ed756dc[translationLocale]))
}, membership_tiktok: { ko: "TikTok 멤버십 인증", en: "TikTok membership" ,
  ...additionalLocales((translationLocale) => (localizedMessages.mfcc4c5fa0cc7[translationLocale]))
}, membership_youtube: { ko: "YouTube 멤버십 인증", en: "YouTube membership" ,
  ...additionalLocales((translationLocale) => (localizedMessages.mf6f4f1813c1c[translationLocale]))
}, share: { ko: "패스포트 공유", en: "Passport share" ,
  ...additionalLocales((translationLocale) => (localizedMessages.mf0fcc38f7587[translationLocale]))
},
  passport_verification: { ko: "팬 인증", en: "Fan verification" ,
  ...additionalLocales((translationLocale) => (localizedMessages.mcb885a4cb68b[translationLocale]))
}, live_reservation: { ko: "LIVE 예약", en: "LIVE reservation" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m09bcaad5a36b[translationLocale]))
}, live_attendance: { ko: "LIVE 출석", en: "LIVE attendance" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m7ec41b9e944f[translationLocale]))
}, mission_completion: { ko: "미션 완료", en: "Mission completed" ,
  ...additionalLocales((translationLocale) => (localizedMessages.maa10a34c3969[translationLocale]))
}, journey_completion: { ko: "여정 완료", en: "Journey completed" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m3f0d9491846e[translationLocale]))
}, benefit_entry: { ko: "래플 응모", en: "Raffle entry" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m16fd929df370[translationLocale]))
}, benefit_entry_refund: { ko: "응모권 환급", en: "Ticket refund" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m17cce492b47c[translationLocale]))
}, manual_certification: { ko: "인증 완료", en: "Verification approved" ,
  ...additionalLocales((translationLocale) => (localizedMessages.ma46534c28efb[translationLocale]))
},
};
const EMPTY_PAGES: FanTicketActivity[] = [];

export function FanTicketHistoryScreen({ creatorSlug, creatorName, locale }: { creatorSlug: string; creatorName: string; locale: FanLocale }) {
  const auth = usePrivy();
  const session = useByUsSession();
  const [before, setBefore] = useState<string | null>(null);
  const [pages, setPages] = useState<FanTicketActivity[]>([]);
  const [pageOwnerKey, setPageOwnerKey] = useState("");
  const url = auth.authenticated ? `/api/me/tickets?creator=${encodeURIComponent(creatorSlug)}&locale=${toContentLocale(locale)}${before ? `&before=${before}` : ""}` : null;
  const resource = useOwnedFanResource(url, parseFanTicketActivity, auth);
  const sdkOwnerId = auth.user?.id ?? null;
  const identityStable = session.ready && auth.ready && auth.authenticated && (!session.ownerId || session.ownerId === sdkOwnerId);
  const ownerKey = `${session.ownerId ?? sdkOwnerId ?? "guest"}:${sdkOwnerId ?? "guest"}:${session.generation}:${creatorSlug}:${locale}`;
  const safePages = identityStable && pageOwnerKey === ownerKey ? pages : EMPTY_PAGES;
  useEffect(() => { setPages([]); setBefore(null); setPageOwnerKey(ownerKey); }, [ownerKey]);
  useEffect(() => {
    if (!identityStable || resource.state.status !== "ready") return;
    const page = resource.state.data;
    setPageOwnerKey(ownerKey);
    setPages((current) => before === null ? [page] : current.some((currentPage) => currentPage.history.some((item) => page.history.some((next) => next.id === item.id))) ? current : [...current, page]);
  }, [before, identityStable, ownerKey, resource.state]);
  const current = identityStable && resource.state.status === "ready" ? resource.state.data : safePages[0];
  const history = useMemo(() => safePages.flatMap((page) => page.history), [safePages]);
  const nextBefore = safePages.at(-1)?.nextBefore ?? current?.nextBefore ?? null;
  const ko = locale === "ko";
  return <FanAppFrame locale={locale} mainId="ticket-history-main"><FanContentContainer as="main" id="ticket-history-main" className={styles.page} tabIndex={-1}>
    <Link className={styles.back} href={`/${creatorSlug}?locale=${locale}` as Route}><ArrowLeft aria-hidden="true" />{locale === "ko" ? `${creatorName} 팬페이지` : translate(locale, localizedMessages.m0c83638a8bf3, "{0} fan page", [creatorName])}</Link>
    <header className={styles.header}><div><p>BYUS RAFFLE TICKETS</p><h1>{locale === "ko" ? "내 응모권 내역" : translate(locale, localizedMessages.m3a9cb21c4224, "My ticket history")}</h1><span>{locale === "ko" ? "적립·사용·환급 내역을 한곳에서 확인하세요." : translate(locale, localizedMessages.m765cd9703acd, "See tickets earned, used, and refunded in one place.")}</span></div><div className={styles.balance}><Ticket aria-hidden="true" /><span>{locale === "ko" ? "보유 응모권" : translate(locale, localizedMessages.m9b707fe509da, "Available tickets")}</span><strong>{current?.balance.toLocaleString(locale) ?? "—"}{ko && current ? "장" : ""}</strong></div></header>
    {auth.ready && auth.authenticated ? <FanTicketGuide creatorSlug={creatorSlug} creatorName={creatorName} locale={locale} /> : null}
    {!auth.ready || !session.ready || (auth.authenticated && (!identityStable || (resource.state.status === "loading" && safePages.length === 0))) ? <p className={styles.state} role="status">{locale === "ko" ? "응모권 내역을 확인하고 있어요." : translate(locale, localizedMessages.m1fefe326893c, "Loading ticket history.")}</p>
      : !auth.authenticated ? <section className={styles.state}><h2>{locale === "ko" ? "로그인이 필요해요" : translate(locale, localizedMessages.m871039fccd8f, "Sign in required")}</h2><p>{locale === "ko" ? "내 응모권과 활동 내역은 로그인 후 확인할 수 있어요." : translate(locale, localizedMessages.m40e669945671, "Sign in to see your balance and activity.")}</p><Link href={`/login?locale=${locale}&returnTo=${encodeURIComponent(`/c/${creatorSlug}/tickets?locale=${locale}`)}` as Route}>{locale === "ko" ? "로그인" : translate(locale, localizedMessages.m28a5a63237a6, "Sign in")}</Link></section>
      : resource.state.status === "error" && safePages.length === 0 ? <section className={styles.state} role="alert"><h2>{locale === "ko" ? "내역을 불러오지 못했어요" : translate(locale, localizedMessages.mf72daa12b614, "Couldn't load history")}</h2><FanAction onClick={resource.retry}><RotateCcw aria-hidden="true" />{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m465a8054ce9f, "Retry")}</FanAction></section>
      : <section className={styles.history} aria-labelledby="ticket-history-heading"><div className={styles.sectionHeading}><h2 id="ticket-history-heading">{locale === "ko" ? "활동 내역" : translate(locale, localizedMessages.m7548b482da0c, "Activity")}</h2><Link href={`/c/${creatorSlug}/raffles?locale=${locale}` as Route}>{locale === "ko" ? "래플 보러 가기" : translate(locale, localizedMessages.mc36e041e627b, "Browse raffles")}<ArrowRight aria-hidden="true" /></Link></div>{history.length === 0 ? <p className={styles.empty}>{locale === "ko" ? "아직 응모권 내역이 없어요. 팬 활동을 시작해 보세요." : translate(locale, localizedMessages.mc9f00fd21d96, "No ticket activity yet. Start with a fan activity.")}</p> : <ol>{history.map((item) => { const localizedSource = sourceNames[item.sourceType]?.[locale]; const raffle = item.sourceType === "benefit_entry" || item.sourceType === "benefit_entry_refund"; const detailLabel = item.label !== item.sourceType ? item.label : null; const label = raffle ? `${localizedSource ?? item.sourceType.replaceAll("_", " ")}${detailLabel ? ` · ${detailLabel}` : ""}` : localizedSource ?? (locale === "ko" ? item.label : item.sourceType.replaceAll("_", " ")); const format = (value: string) => new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); const activityDate = format(item.occurredAt ?? item.createdAt); const payoutDate = item.backfill ? format(item.createdAt) : null; return <li key={item.id}><span className={styles.receiptIcon} data-positive={item.amount > 0}><Ticket aria-hidden="true" /></span><div><strong>{label}</strong><small>{activityDate}{item.backfill ? ` · ${locale === "ko" ? `소급 지급 ${payoutDate}` : translate(locale, localizedMessages.m20718f3ada79, "Backfilled {0}", [payoutDate])}` : ""}</small></div><div className={styles.amount}><strong>{item.amount > 0 ? "+" : ""}{item.amount}{ko ? "장" : ""}</strong><small>{locale === "ko" ? `잔액 ${item.balance}장` : translate(locale, localizedMessages.mee0d1594c763, "Balance {0}", [item.balance])}</small></div></li>; })}</ol>}{resource.state.status === "error" ? <p className={styles.refreshError} role="alert">{locale === "ko" ? "이전 내역을 불러오지 못했어요." : translate(locale, localizedMessages.m670aed6a41ba, "Couldn't load older activity.")} <button type="button" onClick={resource.retry}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m465a8054ce9f, "Retry")}</button></p> : nextBefore ? <button className={styles.more} type="button" disabled={resource.state.status === "loading"} onClick={() => setBefore(nextBefore)}>{resource.state.status === "loading" ? (locale === "ko" ? "불러오는 중…" : translate(locale, localizedMessages.m9e1ad70a12ea, "Loading…")) : (locale === "ko" ? "이전 내역 더 보기" : translate(locale, localizedMessages.md3ceb41a86fd, "Load older activity"))}</button> : null}{resource.refreshFailed ? <p className={styles.refreshError} role="status">{locale === "ko" ? "새 내역을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." : translate(locale, localizedMessages.me35fac22c12d, "Couldn't refresh activity. Try again shortly.")}</p> : null}</section>}
  </FanContentContainer></FanAppFrame>;
}
