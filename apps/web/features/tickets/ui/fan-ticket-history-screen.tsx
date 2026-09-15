"use client";

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

const sourceNames: Record<string, { ko: string; en: string }> = {
  verification: { ko: "팬 인증", en: "Fan verification" }, reaction: { ko: "좋아요", en: "Like" }, comment: { ko: "첫 댓글", en: "First comment" }, checkin: { ko: "데일리 출석", en: "Daily check-in" },
  membership_instagram: { ko: "Instagram 멤버십 인증", en: "Instagram membership" }, membership_tiktok: { ko: "TikTok 멤버십 인증", en: "TikTok membership" }, membership_youtube: { ko: "YouTube 멤버십 인증", en: "YouTube membership" }, share: { ko: "패스포트 공유", en: "Passport share" },
  passport_verification: { ko: "팬 인증", en: "Fan verification" }, live_reservation: { ko: "LIVE 예약", en: "LIVE reservation" }, live_attendance: { ko: "LIVE 출석", en: "LIVE attendance" }, mission_completion: { ko: "미션 완료", en: "Mission completed" }, journey_completion: { ko: "여정 완료", en: "Journey completed" }, benefit_entry: { ko: "래플 응모", en: "Raffle entry" }, benefit_entry_refund: { ko: "응모권 환급", en: "Ticket refund" }, manual_certification: { ko: "인증 완료", en: "Verification approved" },
};
const EMPTY_PAGES: FanTicketActivity[] = [];

export function FanTicketHistoryScreen({ creatorSlug, creatorName, locale }: { creatorSlug: string; creatorName: string; locale: FanLocale }) {
  const auth = usePrivy();
  const session = useByUsSession();
  const [before, setBefore] = useState<string | null>(null);
  const [pages, setPages] = useState<FanTicketActivity[]>([]);
  const [pageOwnerKey, setPageOwnerKey] = useState("");
  const url = auth.authenticated ? `/api/me/tickets?creator=${encodeURIComponent(creatorSlug)}&locale=${locale}${before ? `&before=${before}` : ""}` : null;
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
    <Link className={styles.back} href={`/${creatorSlug}?locale=${locale}` as Route}><ArrowLeft aria-hidden="true" />{ko ? `${creatorName} 팬페이지` : `${creatorName} fan page`}</Link>
    <header className={styles.header}><div><p>BYUS RAFFLE TICKETS</p><h1>{ko ? "내 응모권 내역" : "My ticket history"}</h1><span>{ko ? "적립·사용·환급 내역을 한곳에서 확인하세요." : "See tickets earned, used, and refunded in one place."}</span></div><div className={styles.balance}><Ticket aria-hidden="true" /><span>{ko ? "보유 응모권" : "Available tickets"}</span><strong>{current?.balance.toLocaleString(ko ? "ko-KR" : "en-US") ?? "—"}{ko && current ? "장" : ""}</strong></div></header>
    {auth.ready && auth.authenticated ? <FanTicketGuide creatorSlug={creatorSlug} creatorName={creatorName} locale={locale} /> : null}
    {!auth.ready || !session.ready || (auth.authenticated && (!identityStable || (resource.state.status === "loading" && safePages.length === 0))) ? <p className={styles.state} role="status">{ko ? "응모권 내역을 확인하고 있어요." : "Loading ticket history."}</p>
      : !auth.authenticated ? <section className={styles.state}><h2>{ko ? "로그인이 필요해요" : "Sign in required"}</h2><p>{ko ? "내 응모권과 활동 내역은 로그인 후 확인할 수 있어요." : "Sign in to see your balance and activity."}</p><Link href={`/login?locale=${locale}&returnTo=${encodeURIComponent(`/c/${creatorSlug}/tickets?locale=${locale}`)}` as Route}>{ko ? "로그인" : "Sign in"}</Link></section>
      : resource.state.status === "error" && safePages.length === 0 ? <section className={styles.state} role="alert"><h2>{ko ? "내역을 불러오지 못했어요" : "Couldn't load history"}</h2><FanAction onClick={resource.retry}><RotateCcw aria-hidden="true" />{ko ? "다시 시도" : "Retry"}</FanAction></section>
      : <section className={styles.history} aria-labelledby="ticket-history-heading"><div className={styles.sectionHeading}><h2 id="ticket-history-heading">{ko ? "활동 내역" : "Activity"}</h2><Link href={`/c/${creatorSlug}/raffles?locale=${locale}` as Route}>{ko ? "래플 보러 가기" : "Browse raffles"}<ArrowRight aria-hidden="true" /></Link></div>{history.length === 0 ? <p className={styles.empty}>{ko ? "아직 응모권 내역이 없어요. 팬 활동을 시작해 보세요." : "No ticket activity yet. Start with a fan activity."}</p> : <ol>{history.map((item) => { const localizedSource = sourceNames[item.sourceType]?.[locale]; const raffle = item.sourceType === "benefit_entry" || item.sourceType === "benefit_entry_refund"; const detailLabel = item.label !== item.sourceType ? item.label : null; const label = raffle ? `${localizedSource ?? item.sourceType.replaceAll("_", " ")}${detailLabel ? ` · ${detailLabel}` : ""}` : localizedSource ?? (locale === "ko" ? item.label : item.sourceType.replaceAll("_", " ")); const format = (value: string) => new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); const activityDate = format(item.occurredAt ?? item.createdAt); const payoutDate = item.backfill ? format(item.createdAt) : null; return <li key={item.id}><span className={styles.receiptIcon} data-positive={item.amount > 0}><Ticket aria-hidden="true" /></span><div><strong>{label}</strong><small>{activityDate}{item.backfill ? ` · ${ko ? `소급 지급 ${payoutDate}` : `Backfilled ${payoutDate}`}` : ""}</small></div><div className={styles.amount}><strong>{item.amount > 0 ? "+" : ""}{item.amount}{ko ? "장" : ""}</strong><small>{ko ? `잔액 ${item.balance}장` : `Balance ${item.balance}`}</small></div></li>; })}</ol>}{resource.state.status === "error" ? <p className={styles.refreshError} role="alert">{ko ? "이전 내역을 불러오지 못했어요." : "Couldn't load older activity."} <button type="button" onClick={resource.retry}>{ko ? "다시 시도" : "Retry"}</button></p> : nextBefore ? <button className={styles.more} type="button" disabled={resource.state.status === "loading"} onClick={() => setBefore(nextBefore)}>{resource.state.status === "loading" ? (ko ? "불러오는 중…" : "Loading…") : (ko ? "이전 내역 더 보기" : "Load older activity")}</button> : null}{resource.refreshFailed ? <p className={styles.refreshError} role="status">{ko ? "새 내역을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." : "Couldn't refresh activity. Try again shortly."}</p> : null}</section>}
  </FanContentContainer></FanAppFrame>;
}
