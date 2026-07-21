"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, LockKeyhole, TicketCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
  benefitCatalogItemSchema,
  benefitClaimResponseSchema,
  benefitListResponseSchema,
  type BenefitCatalogItem,
  type BenefitClaimResponse,
  type BenefitState,
} from "../domain/benefit";
import styles from "./benefit-screen.module.css";

export type BenefitLocale = "ko" | "en";

const celebritiesResponseSchema = z.object({
  celebrities: z.array(z.object({ slug: z.string(), name: z.string() })),
});

const copy = {
  ko: {
    nav: ["홈", "셀럽", "라이브", "패스포트", "혜택"], title: "팬 혜택", subtitle: "함께한 기록으로 열리는 특별한 혜택을 확인하세요.",
    filter: "셀럽 선택", allEmpty: "공개된 혜택이 아직 없어요.", filterEmpty: "이 셀럽의 공개된 혜택이 아직 없어요.", emptyHelp: "새 혜택이 열리면 이곳에서 바로 확인할 수 있어요.",
    loadError: "혜택을 불러오지 못했어요.", loadHelp: "잠시 후 다시 시도해 주세요.", retry: "다시 불러오기", back: "혜택 목록", details: "혜택 자세히 보기",
    states: { locked: "잠김", eligible: "수령 가능", claimed: "수령 완료", sold_out: "소진", expired: "종료" },
    period: "수령 기간", requirement: "수령 조건", delivery: "제공 방식", score: "필요 팬 점수", level: "필요 레벨", stamp: "필요 Stamp", activity: "필요 활동",
    claim: "혜택 수령하기", claiming: "수령 처리 중", locked: "조건을 달성하면 수령할 수 있어요", claimed: "이미 수령한 혜택이에요", sold_out: "준비된 혜택이 모두 소진되었어요", expired: "수령 기간이 종료되었어요",
    claimError: "혜택을 수령하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.", delivered: "혜택이 안전하게 전달되었어요", code: "혜택 코드", open: "혜택 열기", copy: "코드 복사", copied: "복사됨",
    notFound: "공개된 혜택을 찾을 수 없어요.", locale: "KO / EN",
  },
  en: {
    nav: ["Home", "Celebrities", "Live", "Passports", "Benefits"], title: "Fan benefits", subtitle: "Discover benefits unlocked by the moments you have shared.",
    filter: "Choose a celebrity", allEmpty: "There are no published benefits yet.", filterEmpty: "This celebrity has no published benefits yet.", emptyHelp: "New benefits will appear here as soon as they open.",
    loadError: "We couldn’t load benefits.", loadHelp: "Please try again shortly.", retry: "Try again", back: "Benefits", details: "View benefit details",
    states: { locked: "Locked", eligible: "Eligible", claimed: "Claimed", sold_out: "Sold out", expired: "Ended" },
    period: "Claim period", requirement: "Eligibility", delivery: "Delivery", score: "Fan score", level: "Level", stamp: "Stamp", activity: "Activity",
    claim: "Claim benefit", claiming: "Claiming", locked: "Complete the requirements to claim", claimed: "You already claimed this benefit", sold_out: "All available benefits have been claimed", expired: "The claim period has ended",
    claimError: "We couldn’t claim this benefit. Check its status and try again.", delivered: "Your benefit was delivered securely", code: "Benefit code", open: "Open benefit", copy: "Copy code", copied: "Copied",
    notFound: "This published benefit could not be found.", locale: "EN / KO",
  },
} as const;

function query(locale: BenefitLocale, celebrity?: string) {
  const params = new URLSearchParams({ locale });
  if (celebrity) params.set("celebrity", celebrity);
  return params.toString();
}

function formatDate(value: string, locale: BenefitLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value));
}

function Header({ locale, celebrity, currentPath = "/benefits" }: { locale: BenefitLocale; celebrity?: string; currentPath?: string }) {
  const c = copy[locale];
  const other = locale === "ko" ? "en" : "ko";
  const hrefs: Route[] = ["/", "/celebrities", "/", "/passports" as Route, `/benefits?${query(locale, celebrity)}` as Route];
  return <header className={styles.header}><div className={styles.headerInner}>
    <Link className={styles.wordmark} href="/" aria-label="ByUs home"><Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={80} height={30} priority /></Link>
    <nav className={styles.nav} aria-label={locale === "ko" ? "주요 메뉴" : "Primary navigation"}>{c.nav.map((label, index) => <Link key={label} href={hrefs[index]} aria-current={index === 4 ? "page" : undefined}>{label}</Link>)}</nav>
    <Link className={styles.locale} href={`${currentPath}?${query(other, celebrity)}` as Route} lang={other} hrefLang={other}>{c.locale}</Link>
  </div></header>;
}

function StateBadge({ state, locale }: { state: BenefitState; locale: BenefitLocale }) {
  return <span className={styles.stateBadge} data-state={state}>{state === "claimed" && <Check aria-hidden="true" />}{state === "locked" && <LockKeyhole aria-hidden="true" />}{copy[locale].states[state]}</span>;
}

function RequirementList({ benefit, locale }: { benefit: BenefitCatalogItem; locale: BenefitLocale }) {
  const c = copy[locale];
  return <dl className={styles.requirements}>
    <div><dt>{c.score}</dt><dd>{new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US").format(benefit.minimumScore)}</dd></div>
    <div><dt>{c.level}</dt><dd>{benefit.minimumLevel}</dd></div>
    {benefit.requiredStampType && <div><dt>{c.stamp}</dt><dd>{benefit.requiredStampType}</dd></div>}
    {benefit.requiredActivityType && <div><dt>{c.activity}</dt><dd>{benefit.requiredActivityType}</dd></div>}
  </dl>;
}

type ListView = { kind: "loading" } | { kind: "error" } | { kind: "ready"; benefits: BenefitCatalogItem[] };

export function BenefitsScreen({ locale, initialCelebrity }: { locale: BenefitLocale; initialCelebrity?: string }) {
  const c = copy[locale]; const router = useRouter(); const { ready, authenticated, getAccessToken } = usePrivy();
  const [celebrities, setCelebrities] = useState<Array<{ slug: string; name: string }>>([]);
  const [selected, setSelected] = useState(initialCelebrity ?? "");
  const [view, setView] = useState<ListView>({ kind: "loading" });

  const loadCelebrities = useCallback(async () => {
    try { const response = await fetch(`/api/public/celebrities?locale=${locale}`); if (!response.ok) throw new Error(); const data = celebritiesResponseSchema.parse(await response.json()); setCelebrities(data.celebrities); setSelected((value) => value || data.celebrities[0]?.slug || ""); } catch { setCelebrities([]); setView({ kind: "error" }); }
  }, [locale]);
  useEffect(() => { void loadCelebrities(); }, [loadCelebrities]);

  const load = useCallback(async () => {
    if (!ready || !selected) return;
    setView({ kind: "loading" });
    try {
      const token = authenticated ? await getAccessToken() : null;
      const response = await fetch(`/api/benefits?${query(locale, selected)}`, { headers: token ? { authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error();
      setView({ kind: "ready", benefits: benefitListResponseSchema.parse(await response.json()).benefits });
    } catch { setView({ kind: "error" }); }
  }, [authenticated, getAccessToken, locale, ready, selected]);
  useEffect(() => { void load(); }, [load]);

  function choose(value: string) { setSelected(value); router.replace(`/benefits?${query(locale, value)}` as Route, { scroll: false }); }

  return <div className={styles.page}><Header locale={locale} celebrity={selected || undefined} /><main className={styles.main}>
    <div className={styles.listHeading}><div><h1>{c.title}</h1><p>{c.subtitle}</p></div><label>{c.filter}<select value={selected} onChange={(event) => choose(event.target.value)} disabled={!celebrities.length}>{celebrities.map((celebrity) => <option key={celebrity.slug} value={celebrity.slug}>{celebrity.name}</option>)}</select></label></div>
    {view.kind === "loading" && <div className={styles.skeletonGrid} aria-busy="true" aria-label={locale === "ko" ? "혜택 불러오는 중" : "Loading benefits"}>{[0,1,2].map((item) => <div key={item}><i /><i /><i /></div>)}</div>}
    {view.kind === "error" && <section className={styles.message} role="alert"><TicketCheck aria-hidden="true" /><h2>{c.loadError}</h2><p>{c.loadHelp}</p><button type="button" onClick={() => void (selected ? load() : loadCelebrities())}>{c.retry}</button></section>}
    {view.kind === "ready" && view.benefits.length === 0 && <section className={styles.message} role="status"><TicketCheck aria-hidden="true" /><h2>{selected ? c.filterEmpty : c.allEmpty}</h2><p>{c.emptyHelp}</p></section>}
    {view.kind === "ready" && view.benefits.length > 0 && <div className={styles.benefitList}>{view.benefits.map((benefit) => <article className={styles.benefitRow} key={benefit.id}>
      <div className={styles.rowContent}><StateBadge state={benefit.state} locale={locale} /><h2>{benefit.title}</h2><p>{benefit.summary}</p><span>{benefit.eligibilityLabel}</span></div>
      <Link className={styles.rowLink} href={`/benefits/${benefit.id}?${query(locale, selected)}` as Route} aria-label={`${benefit.title}: ${c.details}`}><ArrowRight aria-hidden="true" /></Link>
    </article>)}</div>}
  </main></div>;
}

type DetailView = { kind: "loading" } | { kind: "error"; notFound: boolean } | { kind: "ready"; benefit: BenefitCatalogItem };

export function BenefitDetailScreen({ benefitId, locale, celebrity }: { benefitId: string; locale: BenefitLocale; celebrity?: string }) {
  const c = copy[locale]; const { ready, authenticated, getAccessToken } = usePrivy();
  const [view, setView] = useState<DetailView>({ kind: "loading" }); const [pending, setPending] = useState(false); const [claim, setClaim] = useState<BenefitClaimResponse | null>(null); const [actionError, setActionError] = useState(false); const [copied, setCopied] = useState(false); const claimRef = useRef<Promise<void> | null>(null);
  const load = useCallback(async () => { if (!ready) return; setView({ kind: "loading" }); try { const token = authenticated ? await getAccessToken() : null; const response = await fetch(`/api/benefits/${encodeURIComponent(benefitId)}?locale=${locale}`, { headers: token ? { authorization: `Bearer ${token}` } : undefined, cache: "no-store" }); if (!response.ok) { setView({ kind: "error", notFound: response.status === 404 }); return; } const body = z.object({ benefit: benefitCatalogItemSchema }).parse(await response.json()); setView({ kind: "ready", benefit: body.benefit }); } catch { setView({ kind: "error", notFound: false }); } }, [authenticated, benefitId, getAccessToken, locale, ready]);
  useEffect(() => { void load(); }, [load]);

  async function claimBenefit() {
    if (view.kind !== "ready" || pending || claimRef.current) return;
    const operation = (async () => { setPending(true); setActionError(false); try { const token = await getAccessToken(); if (!token) throw new Error(); const keyName = `byus:benefit-claim:${benefitId}`; let idempotencyKey = sessionStorage.getItem(keyName); if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); sessionStorage.setItem(keyName, idempotencyKey); } const response = await fetch(`/api/benefits/${encodeURIComponent(benefitId)}/claim`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey }) }); if (!response.ok) throw new Error(); const result = benefitClaimResponseSchema.parse(await response.json()); setClaim(result); sessionStorage.removeItem(keyName); setView({ kind: "ready", benefit: { ...view.benefit, state: "claimed" } }); } catch { setActionError(true); } finally { setPending(false); claimRef.current = null; } })(); claimRef.current = operation; await operation;
  }
  async function copyCode(value: string) { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }

  if (view.kind === "loading") return <div className={styles.page}><Header locale={locale} celebrity={celebrity} currentPath={`/benefits/${benefitId}`} /><main className={styles.detailMain} aria-busy="true"><div className={styles.detailSkeleton}><i /><i /><i /><i /></div></main></div>;
  if (view.kind === "error") return <div className={styles.page}><Header locale={locale} celebrity={celebrity} currentPath={`/benefits/${benefitId}`} /><main className={styles.detailMain}><section className={styles.message} role={view.notFound ? "status" : "alert"}><TicketCheck aria-hidden="true" /><h1>{view.notFound ? c.notFound : c.loadError}</h1><p>{view.notFound ? c.emptyHelp : c.loadHelp}</p>{!view.notFound && <button type="button" onClick={() => void load()}>{c.retry}</button>}<Link href={`/benefits?${query(locale, celebrity)}` as Route}>{c.back}</Link></section></main></div>;
  const benefit = view.benefit;
  const unavailableCopy = benefit.state === "locked" ? c.locked : benefit.state === "claimed" ? c.claimed : benefit.state === "sold_out" ? c.sold_out : c.expired;
  return <div className={styles.page}><Header locale={locale} celebrity={celebrity} currentPath={`/benefits/${benefitId}`} /><main className={styles.detailMain}>
    <Link className={styles.back} href={`/benefits?${query(locale, celebrity)}` as Route}><ArrowLeft aria-hidden="true" />{c.back}</Link>
    <article className={styles.detail}><div className={styles.detailIntro}><StateBadge state={benefit.state} locale={locale} /><h1>{benefit.title}</h1><p>{benefit.summary}</p></div>
      <div className={styles.detailColumns}><section><h2>{c.requirement}</h2><p>{benefit.eligibilityLabel}</p><RequirementList benefit={benefit} locale={locale} /></section><section><h2>{c.delivery}</h2><p>{benefit.deliveryLabel}</p><dl className={styles.period}><div><dt>{c.period}</dt><dd>{formatDate(benefit.claimOpensAt, locale)} — {formatDate(benefit.claimClosesAt, locale)}</dd></div></dl></section></div>
      {claim ? <section className={styles.delivery} aria-live="polite"><Check aria-hidden="true" /><div><h2>{c.delivered}</h2>{claim.deliveryType === "external_url" ? <a href={claim.deliveryValue} target="_blank" rel="noopener noreferrer">{c.open}<ExternalLink aria-hidden="true" /></a> : <div className={styles.secret}><span>{c.code}</span><code>{claim.deliveryValue}</code><button type="button" onClick={() => void copyCode(claim.deliveryValue)} aria-label={c.copy}><Copy aria-hidden="true" />{copied ? c.copied : c.copy}</button></div>}</div></section> : benefit.state === "eligible" ? <button className={styles.claimButton} type="button" onClick={() => void claimBenefit()} disabled={pending}>{pending ? c.claiming : c.claim}<ArrowRight aria-hidden="true" /></button> : <div className={styles.unavailable}><LockKeyhole aria-hidden="true" /><span>{unavailableCopy}</span></div>}
      {actionError && <p className={styles.actionError} role="alert">{c.claimError}</p>}
    </article>
  </main></div>;
}
