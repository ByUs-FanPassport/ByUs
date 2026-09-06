"use client";

import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CircleHelp, ExternalLink, RotateCcw, Sparkles, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import { BottomSheet, Drawer } from "@/components/ui/overlay/accessible-overlay";
import { parsePassportCollectionResponse } from "../domain/passport-collection";
import type { PassportDetail } from "../domain/passport-detail";
import { levelLabel, stampTypeLabel, type PassportLocale } from "../domain/passport-read-model";
import type { StampDetail } from "../domain/stamp-detail";
import {
  PassportStampCanvas,
  StampArtwork,
  type PassportStampType,
} from "./passport-stamp-artwork";
import { fanUtilityCanvasClassName } from "../../../components/fan-ui/fan-surface";
import { useOwnedFanResource } from "../../../components/fan-ui/use-owned-fan-resource";
import styles from "./passport-screens.module.css";


const copy = {
  ko: {
    passports: "내 패스포트", passportsSub: "최애와 함께한 순간을 패스포트로 모아보세요.", discover: "최애 찾기", open: "패스포트 보기",
    emptyTitle: "아직 발급된 패스포트가 없어요.", emptyBody: "좋아하는 크리에이터의 팬 인증을 완료하면 첫 기록이 시작돼요.", emptyAction: "팬 인증 가능한 크리에이터 보기",
    retry: "다시 불러오기", loadError: "기록을 불러오지 못했어요.", loadErrorBody: "잠시 후 다시 시도해 주세요. 이미 저장된 기록은 사라지지 않아요.", login: "로그인하고 내 기록 보기",
    issued: "발급", score: "팬 점수", stamps: "스탬프", digital: "디지털 발급", pending: "안전하게 발급을 준비하고 있어요", complete: "디지털 발급이 완료됐어요", needsHelp: "발급 상태를 확인하고 있어요",
    detailSub: "함께한 활동과 스탬프를 한곳에서 확인하세요.", stampBook: "스탬프 모음", activity: "최근 활동", noActivity: "아직 활동 기록이 없어요.", noActivityBody: "팬 인증과 라이브 참여를 시작하면 이곳에 차곡차곡 남아요.",
    emptySlot: "다음 순간을 기다리는 중", earned: "받은 스탬프 보기",
    points: "점", digitalInfo: "디지털 발급 정보", token: "Token ID", transaction: "거래 기록", explorer: "발급 기록 확인", noFacts: "발급이 완료되면 확인 정보가 표시돼요.",
    stampDetail: "스탬프 상세", stampDetailSub: "이 스탬프가 남긴 순간을 확인하세요.", earnedOn: "받은 날", activityDate: "활동한 날", reward: "팬 점수", backPassport: "패스포트로 돌아가기", notFound: "기록을 찾을 수 없어요.", notFoundBody: "삭제되었거나 내 소유의 기록이 아닐 수 있어요.",
    nextLevel: "다음 등급", levelMax: "최고 등급에 도달했어요.", remaining: "점 남음", nextBenefit: "다음 혜택", benefitReady: "지금 받을 수 있어요.", benefitLocked: "조건을 달성하면 받을 수 있어요.", viewBenefit: "혜택 확인하기", relatedActivity: "관련 활동", currentScore: "현재", requiredScore: "필요", opensAt: "공개",
    firstReaction: "첫 반응", firstReactionDate: "첫 마음을 남긴 날", firstReactionTransaction: "첫 반응 거래 기록",
  },
  en: {
    passports: "My Passports", passportsSub: "Collect the moments you shared with your favorite artists.", discover: "Discover artists", open: "Open Passport",
    emptyTitle: "No Passports yet", emptyBody: "Complete fan verification for an artist to begin your first record.", emptyAction: "Find artists to verify",
    retry: "Try again", loadError: "We couldn’t load your records.", loadErrorBody: "Please try again shortly. Your saved records are safe.", login: "Sign in to view my records",
    issued: "Issued", score: "Fan Score", stamps: "Stamps", digital: "Digital issuance", pending: "Your digital edition is being prepared", complete: "Digital issuance is complete", needsHelp: "We’re checking the issuance status",
    detailSub: "See your activities and Stamps in one place.", stampBook: "Stamp Book", activity: "Recent activity", noActivity: "No activity yet", noActivityBody: "Fan verification and LIVE participation will appear here.",
    emptySlot: "Waiting for your next moment", earned: "View earned Stamp",
    points: "pts", digitalInfo: "Digital issuance details", token: "Token ID", transaction: "Transaction", explorer: "View issuance record", noFacts: "Details will appear after issuance is complete.",
    stampDetail: "Stamp details", stampDetailSub: "See the moment recorded by this Stamp.", earnedOn: "Issued", activityDate: "Activity date", reward: "Fan Score", backPassport: "Back to Passport", notFound: "Record not found", notFoundBody: "It may not exist or may not belong to your account.",
    nextLevel: "Next Level", levelMax: "You reached the highest Level.", remaining: "pts remaining", nextBenefit: "Next benefit", benefitReady: "Available now", benefitLocked: "Complete the conditions to unlock it.", viewBenefit: "View benefit", relatedActivity: "Related activity", currentScore: "Current", requiredScore: "Required", opensAt: "Opens",
    firstReaction: "First Reaction", firstReactionDate: "First reaction recorded", firstReactionTransaction: "First Reaction transaction",
  },
} as const;

function localeFrom(value: string | null): PassportLocale { return value === "en" ? "en" : "ko"; }
function withLocale(path: string, locale: PassportLocale): Route { return `${path}?locale=${locale}` as Route; }
function date(value: string, locale: PassportLocale): string { return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); }
function passportDate(value: string, locale: PassportLocale): string { return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function shortPassportId(value: string): string { return `${value.slice(0, 8)}…${value.slice(-4)}`; }
function passportSectionHref(id: string, locale: PassportLocale, section: "activity" | "stamp-book"): Route { return `/passports/${id}?locale=${locale}#${section}` as Route; }
function maskHash(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }

function issuanceText(status: string, locale: PassportLocale) {
  const c = copy[locale];
  if (status === "minted") return c.complete;
  if (status === "permanent_failure") return c.needsHelp;
  return c.pending;
}

function missingConditionText(
  condition: NonNullable<PassportDetail["nextBenefit"]>["missingConditions"][number],
  locale: PassportLocale,
): string {
  const c = copy[locale];
  switch (condition.type) {
    case "score":
      return `${c.score}: ${c.currentScore} ${condition.current} / ${c.requiredScore} ${condition.required}`;
    case "level":
      return `${c.nextLevel}: ${levelLabel(locale, condition.required)}`;
    case "stamp":
      return `Stamp: ${stampTypeLabel(locale, condition.required)}`;
    case "activity":
      return locale === "ko"
        ? `활동: ${stampTypeLabel(locale, condition.required)}`
        : `Activity: ${stampTypeLabel(locale, condition.required)}`;
    case "opens_at":
      return `${c.opensAt}: ${date(condition.at, locale)}`;
  }
}

function safeExplorerUrl(baseUrl: string, txHash: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  try {
    const base = new URL(baseUrl);
    if (
      base.protocol !== "https:" ||
      base.pathname !== "/" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) return null;
    const target = new URL(`/tx/${txHash}`, base);
    return target.origin === base.origin && target.pathname === `/tx/${txHash}` ? target.href : null;
  } catch { return null; }
}

function Frame({ locale, children, presentation = "page", collection = false }: { locale: PassportLocale; children: React.ReactNode; presentation?: "page" | "overlay"; collection?: boolean }) {
  if (presentation === "overlay") return <div className={`${styles.app} ${styles.overlayApp}`} data-fan-surface lang={locale}><main className={styles.overlayMain}>{children}</main></div>;
  return <FanAppFrame locale={locale} className={collection ? fanUtilityCanvasClassName : undefined} mainId="passport-content"><div className={`${styles.app} ${collection ? styles.collectionApp : ""}`}><FanContentContainer as="main" className={styles.main} id="passport-content" tabIndex={-1}>{children}</FanContentContainer></div></FanAppFrame>;
}

function Skeleton({ detail = false }: { detail?: boolean }) { return <div className={styles.skeleton} role="status" aria-label="Loading" aria-busy="true"><div className={styles.skeletonLine} /><div className={styles.skeletonLineShort} /><div className={detail ? styles.skeletonDetail : styles.skeletonGrid}>{Array.from({ length: detail ? 5 : 3 }, (_, i) => <span key={i} />)}</div></div>; }

function StateMessage({ locale, kind, retry, returnTo }: { locale: PassportLocale; kind: "auth" | "missing" | "network"; retry: () => void; returnTo: string }) {
  const c = copy[locale]; const missing = kind === "missing";
  const source = new URL(returnTo, "https://byus.local");
  const targetId = source.pathname.split("/").filter(Boolean).at(-1) ?? "collection";
  return <section className={styles.state} aria-labelledby="state-title" role={kind === "network" ? "alert" : "status"}><CircleHelp aria-hidden="true" /><h1 id="state-title">{kind === "auth" ? (locale === "ko" ? "로그인하고 내 패스포트를 확인하세요." : "Sign in to view your Passports.") : missing ? c.notFound : c.loadError}</h1><p>{kind === "auth" ? (locale === "ko" ? "팬 인증과 LIVE 참여로 남긴 기록을 한곳에서 볼 수 있어요." : "See your fan verification and LIVE participation records in one place.") : missing ? c.notFoundBody : c.loadErrorBody}</p>{kind === "auth" ? <AuthIntentLink className={styles.primaryButton} locale={locale} input={{ sourcePath: source.pathname, sourceQuery: source.search, actionType: "OPEN_PASSPORT", targetType: "passport", targetId }}>{c.login}<ArrowRight aria-hidden="true" /></AuthIntentLink> : kind === "network" ? <button className={styles.primaryButton} type="button" onClick={retry}><RotateCcw aria-hidden="true" />{c.retry}</button> : <Link className={styles.secondaryButton} href={withLocale("/passports", locale)}>{c.backPassport}</Link>}</section>;
}

function PageHeading({ title, subtitle, back }: { title: string; subtitle: string; back?: React.ReactNode }) { return <div className={styles.heading}>{back}<div><h1>{title}</h1><p>{subtitle}</p></div></div>; }

function DigitalStatus({ status, locale }: { status: string; locale: PassportLocale }) { return <span className={styles.digitalStatus} data-complete={status === "minted"}><span aria-hidden="true">{status === "minted" ? <Check /> : <Sparkles />}</span>{issuanceText(status, locale)}</span>; }

const parseCollection = (body: unknown) => parsePassportCollectionResponse(body).passports;
const parsePassport = (body: unknown) => (body as { passport: PassportDetail }).passport;
const parseStamp = (body: unknown) => (body as { stamp: StampDetail }).stamp;
const mintNeedsRefresh = (status: string | undefined) => status === "queued" || status === "processing" || status === "retryable";
const collectionNeedsRefresh = (passports: ReturnType<typeof parseCollection>) => passports.some(p => mintNeedsRefresh(p.mint.status));
const passportNeedsRefresh = (passport: PassportDetail) => mintNeedsRefresh(passport.mint.status)
  || mintNeedsRefresh(passport.firstReaction?.mintStatus) || passport.stamps.some(s => mintNeedsRefresh(s.mint.status));
const stampNeedsRefresh = (stamp: StampDetail) => mintNeedsRefresh(stamp.mint.status);

function RefreshNotice({ failed, retry, locale }: { failed: boolean; retry: () => void; locale: PassportLocale }) {
  return failed ? <p className={styles.refreshNotice} role="status">{copy[locale].loadError} <button className={styles.secondaryButton} type="button" onClick={retry}>{copy[locale].retry}</button></p> : null;
}


export function PassportCollectionScreen() {
  const params = useSearchParams(); const locale = localeFrom(params.get("locale")); const c = copy[locale]; const auth = usePrivy();
  const fetcher = useOwnedFanResource(`/api/passports?locale=${locale}`, parseCollection, auth, collectionNeedsRefresh);
  return <Frame locale={locale} collection><div className={styles.collectionHeading}>
      <PageHeading title={c.passports} subtitle={c.passportsSub} />
      {fetcher.state.status === "ready" && fetcher.state.data.length > 0 ? <Link className={styles.discoverLink} href={withLocale("/celebrities", locale)}>{c.discover}<ArrowRight aria-hidden="true" /></Link> : null}
    </div>
    <div id="collection" className={styles.collectionAnchor}>{fetcher.state.status === "loading" ? <Skeleton /> : fetcher.state.status === "error" ? <StateMessage locale={locale} kind={fetcher.state.kind} retry={fetcher.retry} returnTo={`/passports?locale=${locale}`} /> : fetcher.state.data.length === 0 ? <section className={styles.empty} role="status"><BookOpen aria-hidden="true" /><h2>{c.emptyTitle}</h2><p>{c.emptyBody}</p><Link className={styles.primaryButton} href={withLocale("/celebrities", locale)}>{c.emptyAction}<ArrowRight aria-hidden="true" /></Link></section> : <>
      <section className={styles.collection} aria-label={locale === "ko" ? "Passport 목록" : "Passport collection"}>{fetcher.state.data.map((passport) => <article className={styles.passportCard} key={passport.id}>
        <Link className={styles.cardMainLink} href={withLocale(`/passports/${passport.id}`, locale)}>
          <div className={styles.cardMedia}><Image src={passport.celebrity.image.url} alt={passport.celebrity.image.alt} fill sizes="(max-width: 767px) 100vw, 380px" style={{ objectPosition: passport.celebrity.image.position }} /></div>
          <div className={styles.cardTop}><div><h2>{passport.celebrity.name}</h2></div><ArrowRight aria-hidden="true" /></div>
        </Link>
        <div className={styles.cardFacts}>
          <span><strong>{passport.display.level}</strong><small>LEVEL</small></span>
          <Link href={passportSectionHref(passport.id, locale, "activity")}><strong>{passport.score.points}</strong><small>{c.score}</small></Link>
          <Link href={passportSectionHref(passport.id, locale, "stamp-book")}><strong>{passport.stampSummary.total}</strong><small>{c.stamps}</small></Link>
        </div>
        {passport.mint.status !== "minted" ? <DigitalStatus status={passport.mint.status} locale={locale} /> : null}<Link className={styles.openLabel} href={withLocale(`/passports/${passport.id}`, locale)}>{c.open}<ArrowRight aria-hidden="true" /></Link>
      </article>)}</section></>}</div>
  </Frame>;
}

function DigitalDisclosure({ mint, locale, explorerBaseUrl }: { mint: { status: string; txHash: string | null; tokenId: string | null }; locale: PassportLocale; explorerBaseUrl: string }) {
  const c = copy[locale]; const explorer = mint.txHash ? safeExplorerUrl(explorerBaseUrl, mint.txHash) : null;
  const transaction = mint.txHash ? maskHash(mint.txHash) : null;
  const explorerLabel = mint.txHash
    ? locale === "ko"
      ? `거래 기록 ${mint.txHash}, GIWA Sepolia Explorer에서 새 탭으로 열기`
      : `Transaction ${mint.txHash}, open in GIWA Sepolia Explorer in a new tab`
    : "";
  return <details className={styles.disclosure}><summary>{c.digitalInfo}</summary><div>{mint.tokenId ? <p><span>{c.token}</span><strong data-wrap-anywhere>{mint.tokenId}</strong></p> : null}{transaction ? <p><span>{c.transaction}</span>{explorer ? <a className={styles.transactionLink} href={explorer} target="_blank" rel="noreferrer" aria-label={explorerLabel}><strong data-wrap-anywhere>{transaction}</strong><ExternalLink aria-hidden="true" /></a> : <strong data-wrap-anywhere>{transaction}</strong>}</p> : null}{!mint.tokenId && !mint.txHash ? <p>{c.noFacts}</p> : null}</div></details>;
}

function FirstReactionHistory({ firstReaction, locale, explorerBaseUrl }: {
  firstReaction: NonNullable<PassportDetail["firstReaction"]>;
  locale: PassportLocale;
  explorerBaseUrl: string;
}) {
  const c = copy[locale];
  const explorer = firstReaction.mintStatus === "minted" && firstReaction.txHash
    ? safeExplorerUrl(explorerBaseUrl, firstReaction.txHash)
    : null;
  const explorerLabel = firstReaction.txHash
    ? locale === "ko"
      ? `${c.firstReactionTransaction} ${firstReaction.txHash}, GIWA Sepolia Explorer에서 새 탭으로 열기`
      : `${c.firstReactionTransaction} ${firstReaction.txHash}, open in GIWA Sepolia Explorer in a new tab`
    : "";
  return <section className={styles.section} aria-labelledby="first-reaction-title">
    <div className={styles.sectionHeading}><h2 id="first-reaction-title">{c.firstReaction}</h2></div>
    <ol className={styles.timeline}><li>
      <span className={styles.timelineDot} />
      <div><strong>{c.firstReactionDate}</strong><time dateTime={firstReaction.issuedAt}>{date(firstReaction.issuedAt, locale)}</time></div>
      <div aria-live="polite">
        <DigitalStatus status={firstReaction.mintStatus} locale={locale} />
        {explorer && firstReaction.txHash ? <a className={styles.transactionLink} href={explorer} target="_blank" rel="noreferrer" aria-label={explorerLabel}><strong data-wrap-anywhere>{maskHash(firstReaction.txHash)}</strong><ExternalLink aria-hidden="true" /></a> : null}
      </div>
    </li></ol>
  </section>;
}

export function PassportDetailScreen({ id, explorerBaseUrl }: { id: string; explorerBaseUrl: string }) {
  const params = useSearchParams(); const locale = localeFrom(params.get("locale")); const c = copy[locale]; const auth = usePrivy();
  const parse = useCallback((value: unknown) => parsePassport(value), []); const fetcher = useOwnedFanResource(`/api/passports/${encodeURIComponent(id)}?locale=${locale}`, parse, auth, passportNeedsRefresh);
  return <Frame locale={locale}>{fetcher.state.status === "loading" ? <Skeleton detail /> : fetcher.state.status === "error" ? <StateMessage locale={locale} kind={fetcher.state.kind} retry={fetcher.retry} returnTo={`/passports/${id}?locale=${locale}`} /> : <><RefreshNotice failed={fetcher.refreshFailed} retry={fetcher.retry} locale={locale} /><PassportDetailView passport={fetcher.state.data} locale={locale} explorerBaseUrl={explorerBaseUrl} /></>}</Frame>;
}

function PassportDetailView({ passport, locale, explorerBaseUrl }: { passport: PassportDetail; locale: PassportLocale; explorerBaseUrl: string }) {
  const c = copy[locale];
  useEffect(() => {
    const section = window.location.hash === "#activity" ? "activity" : window.location.hash === "#stamp-book" ? "stamp-book" : null;
    if (!section) return;
    const frame = window.requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      document.getElementById(section)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [passport.id]);
  const stamps = [...passport.stamps].sort((left, right) => left.issuedAt.localeCompare(right.issuedAt) || left.id.localeCompare(right.id));
  const activities = [...passport.activities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  const stampRecords = stamps.map((stamp) => ({
    ...stamp,
    points: passport.activities.find((activity) => activity.stampId === stamp.id)?.points,
  }));
  const nextLevel = passport.progress.nextLevel ? levelLabel(locale, passport.progress.nextLevel) : null;
  return <><PageHeading title={`${passport.celebrity.name} Fan Passport`} subtitle={c.detailSub} back={<Link className={styles.back} href={withLocale("/passports", locale)}><ArrowLeft />{c.passports}</Link>} />
    <section className={styles.passportHero}><div className={styles.passportVisual}><PassportStampCanvas celebrityName={passport.celebrity.name} level={passport.display.level} stamps={stampRecords} totalCount={passport.stampSummary.total} locale={locale} priority /><div className={styles.passportFields}><span className={styles.starValue} aria-label={`STAR: ${passport.celebrity.name}`} title={passport.celebrity.name} data-passport-field="star">{passport.celebrity.name}</span><span className={styles.issueDateValue} aria-label={`DATE OF ISSUE: ${passportDate(passport.issuedAt, locale)}`} data-passport-field="issue-date">{passportDate(passport.issuedAt, locale)}</span><span className={styles.fanIdValue} aria-label={`FAN ID: ${passport.id}`} title={passport.id} data-wrap-anywhere data-passport-field="fan-id">{shortPassportId(passport.id)}</span></div></div><div className={styles.identity}><Link className={styles.identityAvatar} href={withLocale(`/c/${passport.celebrity.slug}`, locale)} aria-label={locale === "ko" ? `${passport.celebrity.name} 최애 페이지 보기` : `View ${passport.celebrity.name} creator page`}><CreatorAvatar slug={passport.celebrity.slug} src={passport.celebrity.image.url} size={64} /></Link><div><span>{passport.celebrity.name}</span><strong dir="auto">{passport.owner.nickname ?? passport.display.level}</strong><small>{passport.owner.nickname ? `${passport.display.level} · ` : ""}{c.issued} {date(passport.issuedAt, locale)}</small></div></div><div className={styles.heroFacts}><Link href="#activity"><strong>{passport.score.points}</strong><small>{c.score}</small></Link><Link href="#stamp-book"><strong>{passport.stampSummary.total}</strong><small>{c.stamps}</small></Link></div><div className={styles.levelProgress}><div><strong>{passport.progress.maxed ? passport.display.level : `${passport.display.level} → ${nextLevel}`}</strong><span>{passport.progress.maxed ? c.levelMax : `${passport.progress.remainingPoints} ${c.remaining}`}</span></div><progress aria-label={passport.progress.maxed ? c.levelMax : `${c.nextLevel}: ${nextLevel}`} max={100} value={passport.progress.percent} /></div><DigitalStatus status={passport.mint.status} locale={locale} /></section>
    {passport.nextBenefit ? <section className={styles.nextBenefit} aria-labelledby="next-benefit-title"><div><span>{passport.nextBenefit.state === "eligible" ? c.benefitReady : c.benefitLocked}</span><h2 id="next-benefit-title">{c.nextBenefit}: {passport.nextBenefit.title}</h2><p>{passport.nextBenefit.eligibilityLabel}</p>{passport.nextBenefit.missingConditions.length ? <ul>{passport.nextBenefit.missingConditions.map((condition, index) => <li key={`${condition.type}-${index}`}>{missingConditionText(condition, locale)}</li>)}</ul> : null}</div><Link href={withLocale(`/benefits/${passport.nextBenefit.id}`, locale)}>{c.viewBenefit}<ArrowRight aria-hidden="true" /></Link></section> : null}
    {passport.firstReaction ? <FirstReactionHistory firstReaction={passport.firstReaction} locale={locale} explorerBaseUrl={explorerBaseUrl} /> : null}
    <section id="stamp-book" className={styles.section}><div className={styles.sectionHeading}><h2>{c.stampBook}</h2><p>{passport.stampSummary.total} {c.stamps}</p></div>{stampRecords.length ? <div className={styles.stampGrid}>{stampRecords.map((stamp) => { const stampName = stampTypeLabel(locale, stamp.type); return <Link key={stamp.id} className={styles.stampSlot} href={withLocale(`/stamps/${stamp.id}`, locale)} scroll={false}><div className={styles.stampArtwork}><StampArtwork type={stamp.type} locale={locale} label={stampName} celebrityName={passport.celebrity.name} issuedAt={stamp.issuedAt} points={stamp.points} /></div><strong>{stampName}</strong><span>{date(stamp.issuedAt, locale)}</span><em>{c.earned}</em></Link>; })}</div> : <div className={styles.inlineEmpty}><CalendarDays aria-hidden="true" /><div><strong>{c.noActivity}</strong><p>{c.noActivityBody}</p></div></div>}</section>
    <section id="activity" className={styles.section}><div className={styles.sectionHeading}><h2>{c.activity}</h2></div>{activities.length ? <ol className={styles.timeline}>{activities.map((item) => <li key={item.id}><span className={styles.timelineDot} /><div><strong>{item.context.live ? item.context.live.linkable ? <Link href={withLocale(`/live/${item.context.live.slug}`, locale)}>{item.context.live.title}</Link> : item.context.live.title : item.display.type}</strong><time dateTime={item.occurredAt}>{item.display.type} · {date(item.occurredAt, locale)}</time></div><b>{item.points > 0 ? "+" : ""}{item.points} {c.points}</b></li>)}</ol> : <div className={styles.inlineEmpty}><CalendarDays /><div><strong>{c.noActivity}</strong><p>{c.noActivityBody}</p></div></div>}</section>
    <DigitalDisclosure mint={passport.mint} locale={locale} explorerBaseUrl={explorerBaseUrl} /></>;
}

export function StampDetailScreen({ id, explorerBaseUrl, presentation = "page", onClose }: { id: string; explorerBaseUrl: string; presentation?: "page" | "overlay"; onClose?: () => void }) {
  const params = useSearchParams(); const locale = localeFrom(params.get("locale")); const auth = usePrivy(); const parse = useCallback((value: unknown) => parseStamp(value), []);
  const fetcher = useOwnedFanResource(`/api/stamps/${encodeURIComponent(id)}?locale=${locale}`, parse, auth, stampNeedsRefresh);
  return <Frame locale={locale} presentation={presentation}>{fetcher.state.status === "loading" ? <Skeleton detail /> : fetcher.state.status === "error" ? <StateMessage locale={locale} kind={fetcher.state.kind} retry={fetcher.retry} returnTo={`/stamps/${id}?locale=${locale}`} /> : <><RefreshNotice failed={fetcher.refreshFailed} retry={fetcher.retry} locale={locale} /><StampDetailView stamp={fetcher.state.data} locale={locale} explorerBaseUrl={explorerBaseUrl} onClose={onClose} /></>}</Frame>;
}

function StampDetailView({ stamp, locale, explorerBaseUrl, onClose }: { stamp: StampDetail; locale: PassportLocale; explorerBaseUrl: string; onClose?: () => void }) {
  const c = copy[locale]; return <><PageHeading title={c.stampDetail} subtitle={c.stampDetailSub} back={onClose ? <button className={styles.back} type="button" onClick={onClose} data-autofocus><X />{locale === "ko" ? "상세 닫기" : "Close details"}</button> : <Link className={styles.back} href={withLocale(`/passports/${stamp.passport.id}`, locale)}><ArrowLeft />{c.backPassport}</Link>} />
    <div className={styles.stampDetailLayout}><section className={styles.stampFocus}><span className={styles.momentLabel}>{stamp.celebrity.name}</span><div className={styles.stampArtwork}><StampArtwork type={stamp.type as PassportStampType} locale={locale} label={stamp.display.type} celebrityName={stamp.celebrity.name} issuedAt={stamp.issuedAt} points={stamp.activity.points} /></div><h2>{stamp.display.type}</h2><p>{date(stamp.activity.occurredAt, locale)}</p><DigitalStatus status={stamp.mint.status} locale={locale} /></section><aside className={styles.stampFacts}><h2>{locale === "ko" ? "이 순간의 기록" : "Moment record"}</h2><dl><div><dt>{c.earnedOn}</dt><dd>{date(stamp.issuedAt, locale)}</dd></div><div><dt>{c.activityDate}</dt><dd>{date(stamp.activity.occurredAt, locale)}</dd></div><div><dt>{c.reward}</dt><dd>+{stamp.activity.points} {c.points}</dd></div><div><dt>{c.relatedActivity}</dt><dd>{stamp.activity.context.live ? stamp.activity.context.live.linkable ? <Link href={withLocale(`/live/${stamp.activity.context.live.slug}`, locale)}>{stamp.activity.context.live.title}</Link> : stamp.activity.context.live.title : stamp.display.type}</dd></div></dl><DigitalDisclosure mint={stamp.mint} locale={locale} explorerBaseUrl={explorerBaseUrl} /></aside></div></>;
}

function useMobileDetail() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function StampDetailOverlay({ id, explorerBaseUrl }: { id: string; explorerBaseUrl: string }) {
  const router = useRouter();
  const mobile = useMobileDetail();
  const close = useCallback(() => router.back(), [router]);
  const Overlay = mobile ? BottomSheet : Drawer;
  return <Overlay open onClose={close} labelledBy="stamp-detail-overlay-title" closeOnBackdrop backdropClassName={styles.detailBackdrop} contentClassName={styles.detailOverlay}>
    <h1 className={styles.visuallyHidden} id="stamp-detail-overlay-title">Stamp 상세</h1>
    <StampDetailScreen id={id} explorerBaseUrl={explorerBaseUrl} presentation="overlay" onClose={close} />
  </Overlay>;
}
