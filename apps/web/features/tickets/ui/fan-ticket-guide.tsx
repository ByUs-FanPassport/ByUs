"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Check, Clock3, Ticket } from "lucide-react";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FAN_TICKET_CREATOR_SLUGS, parseFanTicketActivity, type FanTicketAction } from "../domain/fan-ticket-activity";
import styles from "./fan-ticket-guide.module.css";

const actionNames = {
  ko: { verification: "팬 인증", reaction: "좋아요", comment: "첫 댓글", checkin: "오늘 출석", membership_instagram: "Instagram 멤버십", membership_tiktok: "TikTok 멤버십", membership_youtube: "YouTube 멤버십", share: "패스포트 공유" },
  en: { verification: "Fan verification", reaction: "Like", comment: "First comment", checkin: "Today's check-in", membership_instagram: "Instagram membership", membership_tiktok: "TikTok membership", membership_youtube: "YouTube membership", share: "Share Passport" },
} as const;
const statusNames = {
  ko: { available: "참여하기", pending: "확인 중", processing: "지급 처리 중", awarded: "지급 완료" },
  en: { available: "Take part", pending: "Under review", processing: "Processing", awarded: "Awarded" },
} as const;
const conditionNames = {
  ko: { verification: "최초 1회", reaction: "최초 1회", comment: "최초 1회", checkin: "매일 · KST 자정 갱신", membership_instagram: "승인 후 플랫폼별 1회", membership_tiktok: "승인 후 플랫폼별 1회", membership_youtube: "승인 후 플랫폼별 1회", share: "다른 회원의 로그인·방문 확인 후 1회" },
  en: { verification: "Once", reaction: "Once", comment: "Once", checkin: "Daily · resets at midnight KST", membership_instagram: "Once per platform after approval", membership_tiktok: "Once per platform after approval", membership_youtube: "Once per platform after approval", share: "Once after another member signs in and visits" },
} as const;

function actionStatus(action: FanTicketAction, locale: FanLocale) {
  if (action.status !== "pending") return statusNames[locale][action.status];
  if (action.key.startsWith("membership_")) return locale === "ko" ? "인증 확인 중" : "Verification pending";
  if (action.key === "share") return locale === "ko" ? "방문 확인 대기" : "Waiting for a verified visit";
  return statusNames[locale].pending;
}
const shouldPollTicketActivity = (data: ReturnType<typeof parseFanTicketActivity>) => data.actions.some((action) => action.status === "pending" || action.status === "processing");

function withLocale(href: string, locale: FanLocale): Route {
  const [pathAndQuery, hash] = href.split("#", 2);
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  return `${pathAndQuery}${separator}locale=${locale}${hash ? `#${hash}` : ""}` as Route;
}

function ActionRow({ action, locale }: { action: FanTicketAction; locale: FanLocale }) {
  const complete = action.status === "awarded";
  const waiting = action.status === "pending" || action.status === "processing";
  const body = <><span className={styles.actionIcon} data-status={action.status}>{complete ? <Check aria-hidden="true" /> : waiting ? <Clock3 aria-hidden="true" /> : <Ticket aria-hidden="true" />}</span><span><strong>{actionNames[locale][action.key]}</strong><small>{conditionNames[locale][action.key]}</small><small>{actionStatus(action, locale)} · +{action.amount}{locale === "ko" ? "장" : ""}</small></span>{action.status === "available" ? <ArrowRight aria-hidden="true" /> : null}</>;
  return action.status === "available" ? <Link className={styles.action} href={withLocale(action.href, locale)}>{body}</Link> : <div className={styles.action} data-static="true">{body}</div>;
}

export function FanTicketGuide({ creatorSlug, creatorName, locale, compact = false, checkinOnly = false }: { creatorSlug: string; creatorName: string; locale: FanLocale; compact?: boolean; checkinOnly?: boolean }) {
  const auth = usePrivy();
  const targeted = FAN_TICKET_CREATOR_SLUGS.has(creatorSlug);
  const resource = useOwnedFanResource(auth.authenticated && targeted ? `/api/me/tickets?creator=${encodeURIComponent(creatorSlug)}&locale=${locale}` : null, parseFanTicketActivity, auth, shouldPollTicketActivity);

  const activityToday = resource.state.status === "ready" ? resource.state.data.today : null;
  useEffect(() => {
    if (!auth.authenticated || !targeted) return;
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const nextKstMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 60 * 60 * 1000;
    const timer = window.setTimeout(resource.retry, Math.max(1_000, nextKstMidnight - now.getTime() + 1_000));
    return () => window.clearTimeout(timer);
  }, [activityToday, auth.authenticated, resource.retry, targeted]);

  if (!targeted || !auth.ready) return null;
  if (checkinOnly && (!auth.authenticated || resource.state.status !== "ready")) return null;
  if (compact && !auth.authenticated) return <section className={`${styles.summary} ${styles.compact}`} aria-labelledby={`ticket-guide-${creatorSlug}`}>
    <div className={styles.summaryWallet}><Ticket aria-hidden="true" /><h2 id={`ticket-guide-${creatorSlug}`}>{locale === "ko" ? "응모권 모으기" : "Collect tickets"}</h2></div>
    <AuthIntentLink className={styles.summaryLink} locale={locale} input={{ sourcePath: `/${creatorSlug}`, sourceQuery: `?locale=${locale}`, actionType: "APPLY_BENEFIT", targetType: "celebrity", targetId: creatorSlug }}>{locale === "ko" ? "로그인하고 확인" : "Sign in to check"}<ArrowRight aria-hidden="true" /></AuthIntentLink>
  </section>;
  if (!auth.authenticated) return <section className={`${styles.guide} ${compact ? styles.compact : ""}`} aria-labelledby={`ticket-guide-${creatorSlug}`}>
    <div className={styles.heading}><span className={styles.mark}><Ticket aria-hidden="true" /></span><div><h2 id={`ticket-guide-${creatorSlug}`}>{locale === "ko" ? "응모권 모으기" : "Collect raffle tickets"}</h2><p>{locale === "ko" ? `${creatorName} 팬 활동으로 응모권을 모을 수 있어요.` : `Sign in to collect tickets through ${creatorName} fan activities.`}</p></div></div>
    <AuthIntentLink className={styles.login} locale={locale} input={{ sourcePath: `/${creatorSlug}`, sourceQuery: `?locale=${locale}`, actionType: "APPLY_BENEFIT", targetType: "celebrity", targetId: creatorSlug }}>{locale === "ko" ? "로그인하고 확인" : "Sign in to check"}<ArrowRight aria-hidden="true" /></AuthIntentLink>
  </section>;
  if (resource.state.status === "loading") return <section className={`${styles.guide} ${compact ? styles.compact : ""}`} aria-busy="true"><p role="status">{locale === "ko" ? "응모권 활동을 확인하고 있어요." : "Loading ticket activities."}</p></section>;
  if (resource.state.status === "error") return <section className={`${styles.guide} ${compact ? styles.compact : ""}`}><p role="alert">{locale === "ko" ? "응모권 활동을 불러오지 못했어요." : "Couldn't load ticket activities."} <button type="button" onClick={resource.retry}>{locale === "ko" ? "다시 시도" : "Retry"}</button></p></section>;
  const data = resource.state.data;
  if (!data.enabled) return null;
  if (compact) {
    const checkin = data.actions.find(action => action.key === "checkin");
    const checkinLabels = locale === "ko"
      ? { available: "오늘 출석하고 1장 받기", awarded: "오늘 출석 완료", processing: "출석 보상 지급 중", pending: "출석 확인 중" }
      : { available: "Check in for 1 ticket", awarded: "Checked in today", processing: "Check-in reward processing", pending: "Check-in pending" };
    const checkinContent = checkin ? checkin.status === "available"
        ? <Link className={styles.summaryCheckin} href={withLocale(checkin.href, locale)}><Clock3 aria-hidden="true" />{checkinLabels.available}</Link>
        : <span className={styles.summaryCheckin} data-status={checkin.status}>{checkin.status === "awarded" ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}{checkinLabels[checkin.status]}</span> : null;
    if (checkinOnly) return checkinContent;
    return <section className={`${styles.summary} ${styles.compact}`} aria-label={locale === "ko" ? "내 응모권" : "My tickets"}>
      <div className={styles.summaryWallet}><Ticket aria-hidden="true" /><span>{locale === "ko" ? "보유 응모권" : "Tickets"}</span><strong>{data.balance.toLocaleString(locale === "ko" ? "ko-KR" : "en-US")}{locale === "ko" ? "장" : ""}</strong></div>
      {checkinContent}
      <Link className={styles.summaryLink} href={`/c/${creatorSlug}/tickets?locale=${locale}` as Route}>{locale === "ko" ? "응모권 모으기" : "Collect tickets"}<ArrowRight aria-hidden="true" /></Link>
    </section>;
  }
  return <section className={`${styles.guide} ${compact ? styles.compact : ""}`} aria-labelledby={`ticket-guide-${creatorSlug}`}>
    <div className={styles.heading}><span className={styles.mark}><Ticket aria-hidden="true" /></span><div><h2 id={`ticket-guide-${creatorSlug}`}>{locale === "ko" ? "응모권 모으기" : "Collect raffle tickets"}</h2><p>{locale === "ko" ? "활동별 지급 조건을 완료하면 응모권 1장을 받아요." : "Earn one ticket when you meet each activity's reward condition."}</p></div><strong className={styles.balance}>{data.balance.toLocaleString(locale === "ko" ? "ko-KR" : "en-US")}<small>{locale === "ko" ? "장 보유" : " tickets"}</small></strong></div>
    <div className={styles.actions}>{data.actions.map((action) => <ActionRow key={action.key} action={action} locale={locale} />)}</div>
    <div className={styles.footer}><Link href={`/c/${creatorSlug}/tickets?locale=${locale}` as Route}>{compact ? (locale === "ko" ? "전체 방법·내역 보기" : "All ways · History") : (locale === "ko" ? "응모권 내역 보기" : "View ticket history")}<ArrowRight aria-hidden="true" /></Link><Link href={`/c/${creatorSlug}/raffles?locale=${locale}` as Route}>{locale === "ko" ? "래플 보러 가기" : "Browse raffles"}<ArrowRight aria-hidden="true" /></Link></div>
  </section>;
}
