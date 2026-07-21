"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CircleHelp, Languages, RotateCcw, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PassportCollection } from "../domain/passport-collection";
import type { PassportDetail } from "../domain/passport-detail";
import type { PassportLocale } from "../domain/passport-read-model";
import type { StampDetail } from "../domain/stamp-detail";
import styles from "./passport-screens.module.css";

type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; kind: "auth" | "missing" | "network" };
type StampType = "knowledge" | "reservation" | "attendance" | "survey";

const copy = {
  ko: {
    passports: "My Passports", passportsSub: "최애와 함께한 순간을 Passport로 모아보세요.", discover: "새 셀럽 찾기", open: "Passport 열기",
    emptyTitle: "아직 발급된 Passport가 없어요.", emptyBody: "좋아하는 셀럽의 팬 인증을 완료하면 첫 기록이 시작돼요.", emptyAction: "팬 인증 가능한 셀럽 보기",
    retry: "다시 불러오기", loadError: "기록을 불러오지 못했어요.", loadErrorBody: "잠시 후 다시 시도해 주세요. 이미 저장된 기록은 사라지지 않아요.", login: "로그인하고 내 기록 보기",
    issued: "발급", score: "Fan Score", stamps: "Stamp", digital: "디지털 발급", pending: "안전하게 발급을 준비하고 있어요", complete: "디지털 발급이 완료됐어요", needsHelp: "발급 상태를 확인하고 있어요",
    detailSub: "함께한 활동과 Stamp를 한곳에서 확인하세요.", stampBook: "Stamp Book", activity: "최근 활동", noActivity: "아직 활동 기록이 없어요.", noActivityBody: "팬 인증과 라이브 참여를 시작하면 이곳에 차곡차곡 남아요.",
    slot: { knowledge: "팬 인증", reservation: "라이브 예약", attendance: "라이브 출석", survey: "후기 참여" }, emptySlot: "다음 순간을 기다리는 중", earned: "받은 Stamp 보기",
    points: "점", digitalInfo: "디지털 발급 정보", token: "Token ID", transaction: "거래 기록", explorer: "발급 기록 확인", noFacts: "발급이 완료되면 확인 정보가 표시돼요.",
    stampDetail: "Stamp 상세", stampDetailSub: "이 Stamp가 남긴 순간을 확인하세요.", earnedOn: "받은 날", activityDate: "활동한 날", reward: "Fan Score", backPassport: "Passport로 돌아가기", notFound: "기록을 찾을 수 없어요.", notFoundBody: "삭제되었거나 내 소유의 기록이 아닐 수 있어요.",
  },
  en: {
    passports: "My Passports", passportsSub: "Collect the moments you shared with your favorite artists.", discover: "Discover artists", open: "Open Passport",
    emptyTitle: "No Passports yet", emptyBody: "Complete fan verification for an artist to begin your first record.", emptyAction: "Find artists to verify",
    retry: "Try again", loadError: "We couldn’t load your records.", loadErrorBody: "Please try again shortly. Your saved records are safe.", login: "Sign in to view my records",
    issued: "Issued", score: "Fan Score", stamps: "Stamps", digital: "Digital issuance", pending: "Your digital edition is being prepared", complete: "Digital issuance is complete", needsHelp: "We’re checking the issuance status",
    detailSub: "See your activities and Stamps in one place.", stampBook: "Stamp Book", activity: "Recent activity", noActivity: "No activity yet", noActivityBody: "Fan verification and LIVE participation will appear here.",
    slot: { knowledge: "Fan Verification", reservation: "Live Reservation", attendance: "Live Attendance", survey: "Survey" }, emptySlot: "Waiting for your next moment", earned: "View earned Stamp",
    points: "pts", digitalInfo: "Digital issuance details", token: "Token ID", transaction: "Transaction", explorer: "View issuance record", noFacts: "Details will appear after issuance is complete.",
    stampDetail: "Stamp details", stampDetailSub: "See the moment recorded by this Stamp.", earnedOn: "Issued", activityDate: "Activity date", reward: "Fan Score", backPassport: "Back to Passport", notFound: "Record not found", notFoundBody: "It may not exist or may not belong to your account.",
  },
} as const;

const stampAsset: Partial<Record<StampType, string>> = {
  knowledge: "/images/stamps/kara-verification-stamp.png",
  reservation: "/images/stamps/kara-reservation-stamp.png",
  attendance: "/images/stamps/kara-attendance-stamp.png",
  survey: "/images/stamps/kara-survey-stamp.png",
};

function localeFrom(value: string | null): PassportLocale { return value === "en" ? "en" : "ko"; }
function withLocale(path: string, locale: PassportLocale): Route { return `${path}?locale=${locale}` as Route; }
function date(value: string, locale: PassportLocale): string { return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); }
function maskHash(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }

function issuanceText(status: string, locale: PassportLocale) {
  const c = copy[locale];
  if (status === "minted") return c.complete;
  if (status === "permanent_failure") return c.needsHelp;
  return c.pending;
}

function safeExplorerUrl(hash: string): string | null {
  const configured = process.env.NEXT_PUBLIC_BLOCKCHAIN_EXPLORER_TX_BASE;
  if (!configured || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  try {
    const base = new URL(configured);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return null;
    const normalized = base.toString().endsWith("/") ? base.toString() : `${base.toString()}/`;
    const target = new URL(encodeURIComponent(hash), normalized);
    return target.origin === base.origin && target.href.startsWith(normalized) ? target.href : null;
  } catch { return null; }
}

function AppHeader({ locale }: { locale: PassportLocale }) {
  const pathname = usePathname();
  const router = useRouter();
  const next = locale === "ko" ? "en" : "ko";
  return <header className={styles.header}><div className={styles.headerInner}>
    <Link className={styles.wordmark} href={withLocale("/", locale)} aria-label="ByUs home"><Image src="/images/guest-home/byus-wordmark.svg" width={80} height={28} alt="ByUs" priority /></Link>
    <nav aria-label={locale === "ko" ? "주요 메뉴" : "Main navigation"}><Link href={withLocale("/", locale)}>HOME</Link><Link aria-current="page" href={withLocale("/passports", locale)}>PASSPORT</Link><Link href={withLocale("/benefits", locale)}>BENEFIT</Link></nav>
    <button className={styles.locale} type="button" onClick={() => router.push(withLocale(pathname, next))} aria-label={locale === "ko" ? "Switch to English" : "한국어로 변경"}><Languages /><span>{next.toUpperCase()}</span></button>
  </div></header>;
}

function Frame({ locale, children }: { locale: PassportLocale; children: React.ReactNode }) { return <div className={styles.app}><AppHeader locale={locale} /><main className={styles.main}>{children}</main></div>; }

function Skeleton({ detail = false }: { detail?: boolean }) { return <div className={styles.skeleton} aria-label="Loading" aria-busy="true"><div className={styles.skeletonLine} /><div className={styles.skeletonLineShort} /><div className={detail ? styles.skeletonDetail : styles.skeletonGrid}>{Array.from({ length: detail ? 5 : 3 }, (_, i) => <span key={i} />)}</div></div>; }

function StateMessage({ locale, kind, retry, returnTo }: { locale: PassportLocale; kind: "auth" | "missing" | "network"; retry: () => void; returnTo: string }) {
  const c = copy[locale]; const missing = kind === "missing";
  return <section className={styles.state} aria-labelledby="state-title"><CircleHelp /><h1 id="state-title">{missing ? c.notFound : c.loadError}</h1><p>{missing ? c.notFoundBody : c.loadErrorBody}</p>{kind === "auth" ? <Link className={styles.primaryButton} href={`/login?returnTo=${encodeURIComponent(returnTo)}&intent=passport` as Route}>{c.login}<ArrowRight /></Link> : kind === "network" ? <button className={styles.primaryButton} type="button" onClick={retry}><RotateCcw />{c.retry}</button> : <Link className={styles.secondaryButton} href={withLocale("/passports", locale)}>{c.backPassport}</Link>}</section>;
}

function useOwnedApi<T>(url: string, parse: (value: unknown) => T, authReady: boolean, authenticated: boolean, getAccessToken: () => Promise<string | null>) {
  const [nonce, setNonce] = useState(0); const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  useEffect(() => {
    if (!authReady) return; if (!authenticated) { setState({ status: "error", kind: "auth" }); return; }
    const controller = new AbortController(); setState({ status: "loading" });
    void (async () => { try {
      const token = await getAccessToken(); if (!token) { setState({ status: "error", kind: "auth" }); return; }
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (response.status === 401) { setState({ status: "error", kind: "auth" }); return; }
      if (response.status === 404) { setState({ status: "error", kind: "missing" }); return; }
      if (!response.ok) throw new Error("request failed");
      setState({ status: "ready", data: parse(await response.json()) });
    } catch (error) { if (!controller.signal.aborted) setState({ status: "error", kind: "network" }); } })();
    return () => controller.abort();
  }, [authReady, authenticated, getAccessToken, nonce, url, parse]);
  return { state, retry: useCallback(() => setNonce((value) => value + 1), []) };
}

function PageHeading({ title, subtitle, back }: { title: string; subtitle: string; back?: React.ReactNode }) { return <div className={styles.heading}>{back}<div><h1>{title}</h1><p>{subtitle}</p></div></div>; }

function DigitalStatus({ status, locale }: { status: string; locale: PassportLocale }) { return <span className={styles.digitalStatus} data-complete={status === "minted"}><span aria-hidden="true">{status === "minted" ? <Check /> : <Sparkles />}</span>{issuanceText(status, locale)}</span>; }

const parseCollection = (body: unknown) => (body as { passports: PassportCollection }).passports;
const parsePassport = (body: unknown) => (body as { passport: PassportDetail }).passport;
const parseStamp = (body: unknown) => (body as { stamp: StampDetail }).stamp;

export function PassportCollectionScreen() {
  const params = useSearchParams(); const locale = localeFrom(params.get("locale")); const c = copy[locale]; const auth = usePrivy();
  const fetcher = useOwnedApi(`/api/passports?locale=${locale}`, parseCollection, auth.ready, auth.authenticated, auth.getAccessToken);
  return <Frame locale={locale}><PageHeading title={c.passports} subtitle={c.passportsSub} />
    {fetcher.state.status === "loading" ? <Skeleton /> : fetcher.state.status === "error" ? <StateMessage locale={locale} kind={fetcher.state.kind} retry={fetcher.retry} returnTo={`/passports?locale=${locale}`} /> : fetcher.state.data.length === 0 ? <section className={styles.empty}><BookOpen /><h2>{c.emptyTitle}</h2><p>{c.emptyBody}</p><Link className={styles.primaryButton} href={withLocale("/celebrities", locale)}>{c.emptyAction}<ArrowRight /></Link></section> : <>
      <section className={styles.collection} aria-label="Passport collection">{fetcher.state.data.map((passport) => <Link className={styles.passportCard} key={passport.id} href={withLocale(`/passports/${passport.id}`, locale)}>
        <div className={styles.cardMedia}><Image src={passport.celebrity.image.url} alt={passport.celebrity.image.alt} fill sizes="(max-width: 767px) 100vw, 33vw" style={{ objectPosition: passport.celebrity.image.position }} /></div>
        <div className={styles.cardTop}><div><h2>{passport.celebrity.name}</h2><p>{c.issued} {date(passport.issuedAt, locale)}</p></div><ArrowRight /></div>
        <div className={styles.cardFacts}><span><strong>{passport.display.level}</strong><small>LEVEL</small></span><span><strong>{passport.score.points}</strong><small>{c.score}</small></span><span><strong>{passport.stampSummary.total}</strong><small>{c.stamps}</small></span></div>
        <DigitalStatus status={passport.mint.status} locale={locale} /><span className={styles.openLabel}>{c.open}</span>
      </Link>)}</section><Link className={styles.discoverLink} href={withLocale("/celebrities", locale)}>{c.discover}<ArrowRight /></Link></>}
  </Frame>;
}

function StampArtwork({ type, label, empty = false }: { type: StampType; label: string; empty?: boolean }) {
  const asset = stampAsset[type]; return <div className={empty ? styles.emptyArtwork : styles.stampArtwork}>{empty || !asset ? <><Star /><span>{label}</span></> : <Image src={asset} alt={`${label} Stamp`} width={420} height={420} />}</div>;
}

function DigitalDisclosure({ mint, locale }: { mint: { status: string; txHash: string | null; tokenId: string | null }; locale: PassportLocale }) {
  const c = copy[locale]; const explorer = mint.txHash ? safeExplorerUrl(mint.txHash) : null;
  return <details className={styles.disclosure}><summary>{c.digitalInfo}</summary><div>{mint.tokenId ? <p><span>{c.token}</span><strong>{mint.tokenId}</strong></p> : null}{mint.txHash ? <p><span>{c.transaction}</span><strong>{maskHash(mint.txHash)}</strong></p> : null}{explorer ? <a href={explorer} target="_blank" rel="noreferrer">{c.explorer}<ArrowRight /></a> : null}{!mint.tokenId && !mint.txHash ? <p>{c.noFacts}</p> : null}</div></details>;
}

export function PassportDetailScreen({ id }: { id: string }) {
  const params = useSearchParams(); const locale = localeFrom(params.get("locale")); const c = copy[locale]; const auth = usePrivy();
  const parse = useCallback((value: unknown) => parsePassport(value), []); const fetcher = useOwnedApi(`/api/passports/${encodeURIComponent(id)}?locale=${locale}`, parse, auth.ready, auth.authenticated, auth.getAccessToken);
  return <Frame locale={locale}>{fetcher.state.status === "loading" ? <Skeleton detail /> : fetcher.state.status === "error" ? <StateMessage locale={locale} kind={fetcher.state.kind} retry={fetcher.retry} returnTo={`/passports/${id}?locale=${locale}`} /> : <PassportDetailView passport={fetcher.state.data} locale={locale} />}</Frame>;
}

function PassportDetailView({ passport, locale }: { passport: PassportDetail; locale: PassportLocale }) {
  const c = copy[locale]; const byType = useMemo(() => new Map(passport.stamps.map((stamp) => [stamp.type, stamp])), [passport.stamps]); const slots: StampType[] = ["knowledge", "reservation", "attendance", "survey"];
  const activities = [...passport.activities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  return <><PageHeading title={`${passport.celebrity.name} Fan Passport`} subtitle={c.detailSub} back={<Link className={styles.back} href={withLocale("/passports", locale)}><ArrowLeft />{c.passports}</Link>} />
    <section className={styles.passportHero}><div className={styles.passportVisual}><Image src="/images/guest-home/passport-open-empty.png" alt={`${passport.celebrity.name} Fan Passport`} width={1536} height={1024} /></div><div className={styles.identity}><Image src={passport.celebrity.image.url} alt="" width={72} height={72} style={{ objectPosition: passport.celebrity.image.position }} /><div><span>{passport.celebrity.name}</span><strong>{passport.display.level}</strong><small>{c.issued} {date(passport.issuedAt, locale)}</small></div></div><div className={styles.heroFacts}><span><strong>{passport.score.points}</strong><small>{c.score}</small></span><span><strong>{passport.stampSummary.total}</strong><small>{c.stamps}</small></span></div><DigitalStatus status={passport.mint.status} locale={locale} /></section>
    <section className={styles.section}><div className={styles.sectionHeading}><h2>{c.stampBook}</h2><p>{passport.stampSummary.total} {c.stamps}</p></div><div className={styles.stampGrid}>{slots.map((type) => { const stamp = byType.get(type); return stamp ? <Link key={type} className={styles.stampSlot} href={withLocale(`/stamps/${stamp.id}`, locale)}><StampArtwork type={type} label={c.slot[type]} /><strong>{c.slot[type]}</strong><span>{date(stamp.issuedAt, locale)}</span><em>{c.earned}</em></Link> : <div key={type} className={styles.stampSlot} data-empty="true"><StampArtwork type={type} label={c.slot[type]} empty /><strong>{c.slot[type]}</strong><span>{c.emptySlot}</span></div>; })}</div></section>
    <section className={styles.section}><div className={styles.sectionHeading}><h2>{c.activity}</h2></div>{activities.length ? <ol className={styles.timeline}>{activities.map((item) => <li key={item.id}><span className={styles.timelineDot} /><div><strong>{item.display.type}</strong><time dateTime={item.occurredAt}>{date(item.occurredAt, locale)}</time></div><b>{item.points > 0 ? "+" : ""}{item.points} {c.points}</b></li>)}</ol> : <div className={styles.inlineEmpty}><CalendarDays /><div><strong>{c.noActivity}</strong><p>{c.noActivityBody}</p></div></div>}</section>
    <DigitalDisclosure mint={passport.mint} locale={locale} /></>;
}

export function StampDetailScreen({ id }: { id: string }) {
  const params = useSearchParams(); const locale = localeFrom(params.get("locale")); const auth = usePrivy(); const parse = useCallback((value: unknown) => parseStamp(value), []);
  const fetcher = useOwnedApi(`/api/stamps/${encodeURIComponent(id)}?locale=${locale}`, parse, auth.ready, auth.authenticated, auth.getAccessToken);
  return <Frame locale={locale}>{fetcher.state.status === "loading" ? <Skeleton detail /> : fetcher.state.status === "error" ? <StateMessage locale={locale} kind={fetcher.state.kind} retry={fetcher.retry} returnTo={`/stamps/${id}?locale=${locale}`} /> : <StampDetailView stamp={fetcher.state.data} locale={locale} />}</Frame>;
}

function StampDetailView({ stamp, locale }: { stamp: StampDetail; locale: PassportLocale }) {
  const c = copy[locale]; return <><PageHeading title={c.stampDetail} subtitle={c.stampDetailSub} back={<Link className={styles.back} href={withLocale(`/passports/${stamp.passport.id}`, locale)}><ArrowLeft />{c.backPassport}</Link>} />
    <div className={styles.stampDetailLayout}><section className={styles.stampFocus}><span className={styles.momentLabel}>{stamp.celebrity.name}</span><StampArtwork type={stamp.type} label={stamp.display.type} /><h2>{stamp.display.type}</h2><p>{date(stamp.activity.occurredAt, locale)}</p><DigitalStatus status={stamp.mint.status} locale={locale} /></section><aside className={styles.stampFacts}><h2>{locale === "ko" ? "이 순간의 기록" : "Moment record"}</h2><dl><div><dt>{c.earnedOn}</dt><dd>{date(stamp.issuedAt, locale)}</dd></div><div><dt>{c.activityDate}</dt><dd>{date(stamp.activity.occurredAt, locale)}</dd></div><div><dt>{c.reward}</dt><dd>+{stamp.activity.points} {c.points}</dd></div></dl><DigitalDisclosure mint={stamp.mint} locale={locale} /></aside></div></>;
}
