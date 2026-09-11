"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft, ArrowRight, ArrowUpRight, History, Ticket } from "lucide-react";
import { FanAppFrame } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { resolvePhoto } from "@/features/media/domain/public-image";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import type { RaffleList } from "../domain/raffle";
import { benefitListResponseSchema, type BenefitCatalogItem, type BenefitListResponse } from "../domain/benefit";
import type { BenefitEntryResult } from "../domain/benefit-entry";
import { creatorRaffleHref, creatorRafflesHref } from "../domain/raffle-navigation";
import { formatRaffleDateTime } from "./benefit-presentation";
import { RaffleArtwork } from "./raffle-artwork";
import { RaffleEntryPanel } from "./raffle-entry-panel";
import styles from "./creator-raffles-screen.module.css";

export type Raffle = RaffleList["raffles"][number];
type Props = { celebrity: PublishedCelebrity; locale: "ko" | "en"; raffles: Raffle[]; benefitId?: string; deliveryInstructions?: string };
const parseBenefits = (value: unknown) => benefitListResponseSchema.parse(value);

export function raffleStatus(raffle: Raffle, now: number): Raffle["status"] {
  if (raffle.status === "cancelled" || raffle.status === "closed") return raffle.status;
  if (raffle.entryClosesAt && now >= Date.parse(raffle.entryClosesAt)) return "closed";
  if (raffle.entryOpensAt && now < Date.parse(raffle.entryOpensAt)) return "preparing";
  return raffle.status;
}

export function RaffleCreator({ celebrity, locale }: Pick<Props, "celebrity" | "locale">) {
  const photo = resolvePhoto(celebrity.image.photos, "identity.avatar", celebrity.image.url, locale);
  return <div className={styles.creator}><img src={photo.src} alt="" /><span>{celebrity.name} · FOR MY FANS</span></div>;
}

export function deliveryLabel(raffle: Raffle, locale: "ko" | "en") {
  return raffle.fulfillmentMethod === "physical_shipping" ? (locale === "ko" ? "국내 배송" : "Korea shipping")
    : raffle.fulfillmentMethod === "on_site_pickup" ? (locale === "ko" ? "현장 수령" : "On-site pickup") : (locale === "ko" ? "디지털 지급" : "Digital delivery");
}

export function CreatorRafflesScreen(props: Props) {
  const auth = usePrivy();
  // Remount all quantity, receipt and request UI when the authenticated owner changes.
  return <OwnedCreatorRaffles key={`${auth.ready}:${auth.authenticated}:${auth.user?.id ?? ""}:${props.celebrity.slug}:${props.locale}:${props.benefitId ?? ""}`} {...props} />;
}

function OwnedCreatorRaffles({ celebrity, locale, raffles, benefitId, deliveryInstructions }: Props) {
  const auth = usePrivy();
  const ko = locale === "ko";
  const [now, setNow] = useState(() => Date.now());
  const [totalsUnknown, setTotalsUnknown] = useState(false);
  const { refresh: refreshRoute } = useRouter();
  const resource = useOwnedFanResource(`/api/benefits?celebrity=${encodeURIComponent(celebrity.slug)}&locale=${locale}`, parseBenefits, auth);
  const { replaceData, retry } = resource;
  useEffect(() => {
    const next = raffles.flatMap((raffle) => [raffle.entryClosesAt, raffle.entryOpensAt]).filter(Boolean).map((date) => Date.parse(date!)).filter((time) => time > now);
    const timer = setTimeout(() => {
      const current = Date.now();
      if (next.some((time) => time <= current)) { refreshRoute?.(); retry(); }
      setNow(current);
    }, Math.max(1, Math.min(60_000, ...next.map((time) => time - now))));
    return () => clearTimeout(timer);
  }, [now, raffles, refreshRoute, retry]);
  const data = resource.state.status === "ready" ? resource.state.data : null;
  const known = !totalsUnknown && !resource.refreshFailed && data !== null;
  const selected = raffles.find((raffle) => raffle.benefitId === benefitId);
  const benefit = data?.benefits.find((item) => item.id === benefitId) ?? null;
  const balance = known ? data?.benefits.find((item) => item.entry)?.entry?.creatorTicketBalance : undefined;
  const fanHref = `/c/${celebrity.slug}?locale=${locale}`;
  const earnHref = `${fanHref}&tab=live`;
  const historyHref = `/my/raffles?locale=${locale}`;
  const onAccepted = useCallback((result: BenefitEntryResult) => {
    if (result.replayed) { setTotalsUnknown(true); return; }
    if (!data) return;
    const next: BenefitListResponse = { benefits: data.benefits.map((item) => !item.entry ? item : ({ ...item, entry: {
      ...item.entry, creatorTicketBalance: result.resultingBalance,
      ...(item.id === result.benefitId ? { enteredTickets: result.benefitTicketTotal, remainingBenefitTickets: result.remainingBenefitTickets, perFanTicketLimit: result.perFanTicketLimit } : {}),
    } })) };
    replaceData(next);
  }, [data, replaceData]);
  const onReconciled = useCallback((fresh: BenefitCatalogItem) => {
    if (data) replaceData({ benefits: data.benefits.map((item) => item.id === fresh.id ? fresh : !item.entry || !fresh.entry ? item : ({ ...item, entry: { ...item.entry, creatorTicketBalance: fresh.entry.creatorTicketBalance } })) });
    else retry();
    setTotalsUnknown(false);
  }, [data, replaceData, retry]);
  const stateText = (raffle: Raffle) => ({ open: ko ? "응모 가능" : "Open", preparing: ko ? "곧 열려요" : "Coming soon", closed: ko ? "응모 마감" : "Closed", cancelled: ko ? "응모 취소" : "Cancelled" })[raffleStatus(raffle, now)];

  return <FanAppFrame locale={locale} mainId="raffle-main">
    <main className={styles.page} id="raffle-main">
      <Link className={styles.back} href={(selected ? creatorRafflesHref(celebrity.slug, locale) : fanHref) as Route}><ArrowLeft aria-hidden="true" />{selected ? (ko ? `${celebrity.name}의 선물` : `${celebrity.name}’s gifts`) : (ko ? `${celebrity.name} 팬 페이지` : `${celebrity.name} fan page`)}</Link>
      {!selected ? <>
        <header className={styles.hero}>
          <div><RaffleCreator celebrity={celebrity} locale={locale} /><h1>{ko ? "어떤 선물이 마음에 드나요?" : "Which gift will you choose?"}</h1><p>{ko ? `${celebrity.name}와 함께한 순간을, 오래 간직할 선물로.` : `A gift to remember your moments with ${celebrity.name}.`}<br />{ko ? "모은 응모권을 원하는 선물에 사용해 보세요." : "Use your raffle tickets for the gift you love."}</p></div>
          <aside className={styles.wallet}><span><Ticket aria-hidden="true" />{celebrity.name} {ko ? "응모권" : "tickets"}</span><strong>{!auth.ready ? "…" : !auth.authenticated ? (ko ? "로그인 후 확인" : "Sign in to check") : balance === undefined ? "—" : `${balance}${ko ? "장" : ""}`}</strong><p>{ko ? "원하는 선물에 나누어 쓰거나, 한 선물에 모아 쓸 수 있어요." : "Split your tickets between gifts, or use them all for one."}</p><Link href={earnHref as Route}>{ko ? "응모권 모으기" : "Collect tickets"}<ArrowUpRight aria-hidden="true" /></Link></aside>
        </header>
        {auth.authenticated && (!known || resource.refreshFailed) ? <div className={styles.notice} role="status">{resource.state.status === "loading" ? (ko ? "내 응모권을 확인하고 있어요." : "Checking your tickets.") : (ko ? "내 응모권을 불러오지 못했어요." : "We couldn’t load your tickets.")}<FanAction variant="text" onClick={resource.retry}>{ko ? "다시 확인" : "Try again"}</FanAction></div> : null}
        <h2 className={styles.sectionTitle}>{ko ? "응모할 선물" : "Gifts to enter for"} <span>{raffles.length}</span></h2>
        {raffles.length === 0 ? <p className={styles.notice}>{ko ? "새로운 선물을 준비하고 있어요." : "New gifts are on the way."}</p> : <div className={styles.grid} data-testid="raffle-grid">
          {raffles.map((raffle) => {
            const owned = known ? data?.benefits.find((item) => item.id === raffle.benefitId)?.entry : null;
            return <article className={styles.card} key={raffle.id}>
              <RaffleArtwork raffle={raffle} />
              <div className={styles.cardBody}><div className={styles.cardMeta}><strong>{ko ? `${raffle.winnerQuantity}명 당첨` : `${raffle.winnerQuantity} winners`}</strong><span>{deliveryLabel(raffle, locale)}</span></div><h3>{raffle.title}</h3><p>{raffle.summary}</p><span className={styles.deadline}>{raffle.entryClosesAt ? `${ko ? "마감" : "Closes"} ${formatRaffleDateTime(raffle.entryClosesAt, locale)}` : stateText(raffle)}</span><div className={styles.myEntry}><span>{ko ? "내 응모" : "My entries"}</span><strong>{!auth.authenticated ? (ko ? "로그인 후 확인" : "Sign in to check") : owned ? `${owned.enteredTickets}${ko ? "장" : ""}` : "—"}</strong></div>{raffle.benefitId ? <FanAction fullWidth href={creatorRaffleHref(celebrity.slug, raffle.benefitId, locale)} trailingIcon={<ArrowRight />}>{raffleStatus(raffle, now) === "open" ? (ko ? "선물 보고 응모하기" : "View gift and enter") : `${stateText(raffle)} · ${ko ? "자세히 보기" : "View details"}`}</FanAction> : <span className={styles.deadline}>{stateText(raffle)}</span>}</div>
            </article>;
          })}
        </div>}
        <p className={styles.notice}><Ticket aria-hidden="true" />{ko ? "선물마다 따로 응모해요. 선택한 선물과 수량을 확인한 뒤 응모권이 차감돼요." : "Enter each gift separately. Tickets are deducted after you confirm the gift and quantity."}</p>
      </> : <>
        <section className={styles.detailHero}><RaffleArtwork raffle={selected} large /><div className={styles.detailCopy}><div className={styles.detailTop}><RaffleCreator celebrity={celebrity} locale={locale} /><span className={styles.status}>{stateText(selected)}</span></div><h1>{selected.title}</h1><p>{selected.summary}</p><dl className={styles.facts}><div><dt>{ko ? "당첨 인원" : "Winners"}</dt><dd>{selected.winnerQuantity}{ko ? "명" : ""}</dd></div><div><dt>{ko ? "응모 마감" : "Entry deadline"}</dt><dd>{selected.entryClosesAt ? formatRaffleDateTime(selected.entryClosesAt, locale) : "—"}</dd></div><div><dt>{ko ? "받는 방법" : "Delivery"}</dt><dd>{deliveryLabel(selected, locale)}</dd></div></dl>{selected.fulfillmentPolicy?.pickupVenue[locale] ? <p className={styles.small}>{selected.fulfillmentPolicy.pickupVenue[locale]}{selected.fulfillmentPolicy.pickupEndsOn ? ` · ${ko ? "수령 기한" : "Collect by"} ${selected.fulfillmentPolicy.pickupEndsOn}` : ""}</p> : null}</div></section>
        <RaffleEntryPanel celebrity={celebrity} locale={locale} raffle={selected} benefit={known ? benefit : null} loading={resource.state.status === "loading"} loadFailed={!known && resource.state.status !== "loading"} refresh={resource.retry} onAccepted={onAccepted} onReconciled={onReconciled} status={raffleStatus(selected, now)} />
        {deliveryInstructions ? <p className={styles.notice}>{deliveryInstructions}</p> : null}
      </>}
      <nav className={styles.support} aria-label={ko ? "응모 관련 메뉴" : "Raffle links"}><Link href={earnHref as Route}><Ticket aria-hidden="true" /><span><strong>{ko ? "응모권 모으기" : "Collect tickets"}</strong><small>{ko ? `${celebrity.name} 팬 활동에서 참여 방법을 확인하세요.` : `Explore ${celebrity.name}’s fan activities.`}</small></span><ArrowUpRight aria-hidden="true" /></Link><Link href={historyHref as Route}><History aria-hidden="true" /><span><strong>{ko ? "내 응모 내역" : "My raffle entries"}</strong><small>{ko ? "이미 응모한 선물과 결과를 확인하세요." : "Check the gifts you entered for and your results."}</small></span><ArrowUpRight aria-hidden="true" /></Link></nav>
    </main>
  </FanAppFrame>;
}
