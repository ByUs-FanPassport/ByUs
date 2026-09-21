"use client";
import { messages } from "@/i18n/catalogs/components__banksy-promotion__banksy-promotion";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Ticket, X } from "lucide-react";
import { Dialog } from "@/components/ui/overlay/accessible-overlay";
import { usePageLocale } from "@/components/locale-provider";
import { creatorSlugFromHomePath } from "@/features/creator/domain/creator-navigation";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";
import type { RaffleList } from "@/features/benefit/domain/raffle";
import { formatRaffleDateTime } from "@/features/benefit/ui/benefit-presentation";
import { useCreatorRaffles } from "@/features/fanpage/ui/home-panels";
import styles from "./banksy-promotion.module.css";

type Raffle = RaffleList["raffles"][number];
const banksyTicketId = "fff318a6-24c7-4012-8290-3494a55e287c";
const seenKey = "byus:banksy-promotion:202609:v1";
let seenInMemory = false;
function hasSeen() {
  try { return seenInMemory || sessionStorage.getItem(seenKey) === "seen"; }
  catch { return seenInMemory; }
}
function markSeen() {
  seenInMemory = true;
  try { sessionStorage.setItem(seenKey, "seen"); } catch { /* Keep dismissal for this app session when storage is unavailable. */ }
}

export function supportsBanksyPromotion(pathname: string, search: string) {
  const query = new URLSearchParams(search);
  if (["authIntent", "intent", "returnTo"].some(key => query.has(key))) return false;
  if (query.has("tab") && query.get("tab") !== "home") return false;
  return ["/", "/celebrities", "/live", "/bias", "/guide", "/pages/elina-fan-guide", "/pages/ifew-fan-guide"].includes(pathname)
    || creatorSlugFromHomePath(pathname) !== null
    || /^\/live\/[^/]+$/.test(pathname);
}

function CampaignCopy({ raffle, locale, modal = false }: { raffle: Raffle; locale: AppLocale; modal?: boolean }) {
  const ko = locale === "ko";
  return <>
    <span className={styles.eyebrow}><span className={styles.status}>{ko ? "응모 진행 중" : translate(locale, messages.banksy_status, "GIVEAWAY OPEN")}</span><span>ELINA × BANKSY</span></span>
    <h2 id={modal ? "banksy-promotion-title" : undefined}>{ko ? <>뱅크시를 만나는{" "}<br />특별한 기회.</> : <>{translate(locale, messages.banksy_titleStart, "Your chance")}{" "}<br />{translate(locale, messages.banksy_titleEnd, "to see Banksy.")}</>}</h2>
    <p className={styles.description}>{ko ? <>더현대 서울 뱅크시 전시 관람권<br /><strong>{raffle.winnerQuantity}명 추첨</strong> · 엘리나와 함께하는 이벤트</> : <>{translate(locale, messages.banksy_venue, "Banksy exhibition at The Hyundai Seoul")}<br /><strong>{translate(locale, messages.banksy_winners, "{0} winners", [raffle.winnerQuantity])}</strong> · {translate(locale, messages.banksy_event, "A giveaway with Elina")}</>}</p>
    {raffle.entryClosesAt && <p className={styles.deadline}><time dateTime={raffle.entryClosesAt}>{formatRaffleDateTime(raffle.entryClosesAt, locale)}</time> {ko ? "마감" : translate(locale, messages.banksy_closes, "closes")}</p>}
  </>;
}

export function BanksyFanBanner({ available, locale }: { available: readonly Raffle[]; locale: AppLocale }) {
  const raffle = available.find(item => item.benefitId === banksyTicketId);
  if (!raffle) return null;
  return <section className={styles.banner} aria-label={locale === "ko" ? "엘리나 뱅크시 이벤트" : translate(locale, messages.banksy_label, "Elina Banksy giveaway")}>
    <Image className={styles.bannerImage} src="/images/guest-home/banksy-exhibition-campaign.webp" alt="" fill sizes="(max-width: 767px) 100vw, 1200px" />
    <div className={styles.bannerCopy}><CampaignCopy raffle={raffle} locale={locale} /></div>
    <Link className={styles.bannerAction} href={creatorRafflesHref("elina", locale)} onClick={markSeen}>
      <Ticket aria-hidden="true" /><span>{locale === "ko" ? "이벤트 응모하러 가기" : translate(locale, messages.banksy_cta, "Explore the giveaway")}</span><ArrowUpRight aria-hidden="true" />
    </Link>
  </section>;
}

function BanksyEntryPrompt({ locale }: { locale: AppLocale }) {
  const { available } = useCreatorRaffles("elina", locale);
  const raffle = available.find(item => item.benefitId === banksyTicketId);
  const [open, setOpen] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const active = Boolean(raffle);
  useEffect(() => {
    if (!active || hasSeen()) return;
    const tryOpen = () => {
      if (hasSeen() || document.visibilityState === "hidden") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [data-overlay-host], dialog[open]')) return;
      if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
      markSeen();
      setOpen(true);
    };
    const timer = window.setTimeout(tryOpen, 350);
    // A login or another dialog gets to finish before the campaign can open.
    const observer = new MutationObserver(tryOpen);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusout", tryOpen);
    document.addEventListener("visibilitychange", tryOpen);
    return () => { window.clearTimeout(timer); observer.disconnect(); document.removeEventListener("focusout", tryOpen); document.removeEventListener("visibilitychange", tryOpen); };
  }, [active]);
  if (!raffle) return null;
  const close = () => { markSeen(); setOpen(false); };
  const ko = locale === "ko";
  return <Dialog open={open} onClose={close} labelledBy="banksy-promotion-title" initialFocusRef={headingRef} backdropClassName={styles.backdrop} contentClassName={styles.dialog}>
    <button type="button" className={styles.close} onClick={close} aria-label={ko ? "이벤트 안내 닫기" : translate(locale, messages.banksy_close, "Close giveaway")}><X aria-hidden="true" /></button>
    <div className={styles.cover}>
      <Image src="/images/guest-home/banksy-exhibition-campaign.webp" alt="" fill sizes="(max-width: 767px) 100vw, 420px" priority />
      <div className={styles.coverType} aria-hidden="true"><span>ELINA ×</span><strong>BANKSY</strong><span>ART IS CLOSER THAN YOU THINK.</span></div>
    </div>
    <div className={styles.dialogBody}>
      <div ref={headingRef} tabIndex={-1} className={styles.copyFocus}><CampaignCopy raffle={raffle} locale={locale} modal /></div>
      <Link className={styles.primaryAction} href={creatorRafflesHref("elina", locale)} onClick={close}>{ko ? "이벤트 응모하러 가기" : translate(locale, messages.banksy_cta, "Explore the giveaway")}<ArrowUpRight aria-hidden="true" /></Link>
      <p className={styles.entryNote}>{ko ? "선물을 고르고 엘리나 응모권으로 응모하세요." : translate(locale, messages.banksy_note, "Choose a prize and enter with your Elina raffle tickets.")}</p>
      <button className={styles.later} type="button" onClick={close}>{ko ? "지금은 둘러볼게요" : translate(locale, messages.banksy_later, "Keep browsing")}</button>
    </div>
  </Dialog>;
}

export function BanksyEntryPromotion() {
  const pathname = usePathname();
  const search = useSearchParams();
  const locale = usePageLocale();
  if (!pathname || !supportsBanksyPromotion(pathname, search.toString())) return null;
  return <BanksyEntryPrompt key={pathname} locale={locale} />;
}
