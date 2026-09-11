"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Clock3, Gift, RotateCcw, TicketCheck, XCircle } from "lucide-react";
import { useCallback } from "react";

import { withLocalePath } from "@/components/locale-path";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { isRecipientOverdue } from "../domain/raffle-fulfillment-policy";
import { ownedRaffleResultSchema, type OwnedRaffleResult } from "../domain/raffle-result";
import { formatRaffleDateTime } from "./benefit-presentation";
import styles from "./raffle-result-panel.module.css";

type Locale = "ko" | "en";

const copy = {
  ko: {
    heading: "내 응모 결과",
    loading: "응모 결과를 확인하는 중이에요.",
    error: "응모 결과를 불러오지 못했어요.",
    errorHelp: "결과를 다시 확인해 주세요. 조회 실패는 미당첨을 뜻하지 않아요.",
    retry: "다시 확인",
    login: "로그인하고 내 응모 결과 확인하기",
    notEntered: "응모 내역이 없어요",
    notEnteredHelp: "이 경품에 사용한 응모권이 없어요.",
    pending: "결과 발표를 기다리고 있어요",
    pendingHelp: "발표 전에는 당첨 여부가 공개되지 않아요.",
    notWon: "이번에는 당첨되지 않았어요",
    notWonHelp: "다른 래플도 확인해 보세요.",
    won: "당첨됐어요",
    cancelled: "래플이 취소됐어요",
    cancelledHelp: "취소 및 응모권 처리 안내는 경품 상세에서 확인해 주세요.",
    entered: "사용한 응모권",
    closed: "응모 마감",
    published: "결과 발표",
    deadline: "수령 정보 제출 마감",
    enterRecipient: "수령 정보 입력하기",
    editRecipient: "수령 정보 확인하기",
    pickup: "수령 방법 확인하기",
    other: "다른 래플 보기",
    submitted: "수령 정보가 접수됐어요",
    submittedHelp: "입력한 정보를 확인한 뒤 다음 안내를 기다려 주세요.",
    shippingPreparing: "배송을 준비하고 있어요",
    shippingTransit: "배송 중이에요",
    shippingComplete: "배송이 완료됐어요",
    pickupAvailable: "현장 수령이 가능해요",
    pickupComplete: "현장 수령을 완료했어요",
    digitalComplete: "경품 지급이 완료됐어요",
    overdue: "수령 정보 제출 기한이 지났어요",
    overdueHelp: "당첨 이력은 유지돼요. 필요한 경우 ByUs에 문의해 주세요.",
    unclaimed: "수령이 종료됐어요",
    unclaimedHelp: "당첨 이력은 유지돼요. 수령과 관련한 문의는 ByUs에 알려 주세요.",
    contact: "ByUs에 문의하기",
    venue: "수령 장소",
    pickupPeriod: "수령 가능 기간",
  },
  en: {
    heading: "My raffle result",
    loading: "Checking your raffle result.",
    error: "We couldn’t load your raffle result.",
    errorHelp: "Try checking again. A failed request does not mean you were not selected.",
    retry: "Check again",
    login: "Sign in to check my raffle result",
    notEntered: "No entry found",
    notEnteredHelp: "You did not use any raffle tickets for this benefit.",
    pending: "Waiting for the result",
    pendingHelp: "Your result stays private until the announcement is published.",
    notWon: "You weren’t selected this time",
    notWonHelp: "You can explore other raffles.",
    won: "You won",
    cancelled: "This raffle was cancelled",
    cancelledHelp: "Check the benefit details for cancellation and raffle ticket information.",
    entered: "Raffle tickets used",
    closed: "Entries closed",
    published: "Result published",
    deadline: "Recipient details due",
    enterRecipient: "Enter recipient details",
    editRecipient: "Review recipient details",
    pickup: "View pickup instructions",
    other: "View other raffles",
    submitted: "Your recipient details were received",
    submittedHelp: "Review your details and wait for the next update.",
    shippingPreparing: "Preparing your shipment",
    shippingTransit: "Your prize is in transit",
    shippingComplete: "Your prize was delivered",
    pickupAvailable: "Your prize is ready for pickup",
    pickupComplete: "Pickup is complete",
    digitalComplete: "Your prize was delivered",
    overdue: "The recipient details deadline has passed",
    overdueHelp: "Your winning history remains available. Contact ByUs if you need help.",
    unclaimed: "Prize collection has closed",
    unclaimedHelp: "Your winning history remains available. Contact ByUs with collection questions.",
    contact: "Contact ByUs",
    venue: "Pickup venue",
    pickupPeriod: "Pickup available through",
  },
} as const;

function resultStatus(result: OwnedRaffleResult, locale: Locale) {
  const t = copy[locale];
  if (result.claimDisposition === "unclaimed") return { title: t.unclaimed, description: t.unclaimedHelp };
  if (isRecipientOverdue(result.recipientDeadlineAt, result.recipientSubmitted, new Date())) {
    return { title: t.overdue, description: t.overdueHelp };
  }
  switch (result.fulfillmentStatus) {
    case "ready": return { title: t.submitted, description: t.submittedHelp };
    case "shipping_preparing": return { title: t.shippingPreparing };
    case "shipping_in_transit": return { title: t.shippingTransit };
    case "shipping_completed": return { title: t.shippingComplete };
    case "pickup_available": return { title: t.pickupAvailable };
    case "pickup_completed": return { title: t.pickupComplete };
    case "digital_delivered": return { title: t.digitalComplete };
    default: return { title: t.won };
  }
}

export function RaffleResultPanel({ result, locale, embedded = false }: { result: OwnedRaffleResult; locale: Locale; embedded?: boolean }) {
  const t = copy[locale];
  const recipientHref = result.winnerId
    ? withLocalePath(`/my/rewards/${result.winnerId}/recipient`, locale)
    : null;
  const overdue = result.state === "won" && isRecipientOverdue(result.recipientDeadlineAt, result.recipientSubmitted, new Date());
  const isClosed = result.claimDisposition === "unclaimed" || overdue;
  const wonStatus = result.state === "won" ? resultStatus(result, locale) : null;
  const state = result.state === "not_entered"
    ? { title: t.notEntered, description: t.notEnteredHelp, icon: <TicketCheck /> }
    : result.state === "pending"
      ? { title: t.pending, description: t.pendingHelp, icon: <Clock3 /> }
      : result.state === "not_won"
        ? { title: t.notWon, description: t.notWonHelp, icon: <XCircle /> }
        : result.state === "cancelled"
          ? { title: t.cancelled, description: t.cancelledHelp, icon: <XCircle /> }
          : { title: wonStatus!.title, description: wonStatus!.description, icon: <Gift /> };
  const recipientLabel = result.fulfillmentStatus === "pickup_available"
    ? t.pickup
    : result.recipientSubmitted
      ? t.editRecipient
      : t.enterRecipient;
  const showRecipientAction = result.state === "won" && !isClosed && recipientHref
    && result.method !== "digital"
    && (result.fulfillmentStatus === "information_required" || result.fulfillmentStatus === "ready" || result.fulfillmentStatus === "pickup_available");

  if (embedded && result.state === "not_entered") {
    return <p className={styles.emptySummary} role="status"><TicketCheck aria-hidden="true" />{t.notEntered}</p>;
  }
  return (
    <section className={`${styles.panel} ${embedded ? styles.embedded : ""}`} aria-labelledby={`raffle-result-${result.benefitId}`}>
      <span className={styles.eyebrow}>{t.heading}</span>
      <div className={styles.status} data-state={result.state}>
        <span aria-hidden="true">{state.icon}</span>
        <div>
          <h2 id={`raffle-result-${result.benefitId}`}>{state.title}</h2>
          <p>{state.description}</p>
        </div>
      </div>
      {!embedded ? <h3>{result.title}</h3> : null}
      <dl className={styles.facts}>
        {result.enteredTickets > 0 ? <div><dt>{t.entered}</dt><dd>{result.enteredTickets}</dd></div> : null}
        {!embedded && result.entryClosesAt ? <div><dt>{t.closed}</dt><dd><time dateTime={result.entryClosesAt}>{formatRaffleDateTime(result.entryClosesAt, locale)}</time></dd></div> : null}
        {result.publishedAt ? <div><dt>{t.published}</dt><dd><time dateTime={result.publishedAt}>{formatRaffleDateTime(result.publishedAt, locale)}</time></dd></div> : null}
        {result.state === "won" && result.recipientDeadlineAt ? <div><dt>{t.deadline}</dt><dd><time dateTime={result.recipientDeadlineAt}>{formatRaffleDateTime(result.recipientDeadlineAt, locale)}</time></dd></div> : null}
        {result.state === "won" && result.fulfillmentStatus === "pickup_available" && result.policy?.pickupVenue[locale]
          ? <div><dt>{t.venue}</dt><dd>{result.policy.pickupVenue[locale]}</dd></div> : null}
        {result.state === "won" && result.fulfillmentStatus === "pickup_available" && result.policy?.pickupEndsOn
          ? <div><dt>{t.pickupPeriod}</dt><dd>{result.policy.pickupEndsOn}</dd></div> : null}
        {result.state === "won" && ["shipping_in_transit", "shipping_completed"].includes(result.fulfillmentStatus ?? "") && result.carrier
          ? <div><dt>{locale === "ko" ? "택배사" : "Carrier"}</dt><dd>{result.carrier}</dd></div> : null}
        {result.state === "won" && ["shipping_in_transit", "shipping_completed"].includes(result.fulfillmentStatus ?? "") && result.trackingNumber
          ? <div><dt>{locale === "ko" ? "운송장 번호" : "Tracking number"}</dt><dd>{result.trackingNumber}</dd></div> : null}
      </dl>
      {result.state === "won" && result.fulfillmentStatus === "pickup_available" && result.policy?.pickupInstructions[locale]
        ? <p className={styles.instructions}>{result.policy.pickupInstructions[locale]}</p> : null}
      <div className={styles.actions}>
        {showRecipientAction ? <FanAction variant="primary" href={recipientHref} trailingIcon={<ArrowRight />}>{recipientLabel}</FanAction> : null}
        {isClosed ? <FanAction variant="neutral" href="mailto:biz@sallylab.io">{t.contact}</FanAction> : null}
        {result.state === "not_won" ? <FanAction variant="neutral" href={withLocalePath("/benefits", locale)}>{t.other}</FanAction> : null}
      </div>
    </section>
  );
}

export function BenefitRaffleResult({ benefitId, locale, embedded = false }: { benefitId: string; locale: Locale; embedded?: boolean }) {
  const auth = usePrivy();
  const parse = useCallback((body: unknown) => ownedRaffleResultSchema.parse(body), []);
  const resource = useOwnedFanResource(
    auth.authenticated ? `/api/benefits/${encodeURIComponent(benefitId)}/result?locale=${locale}` : null,
    parse,
    auth,
  );
  if (!auth.ready) return <FanState kind="loading" title={copy[locale].loading} />;
  if (!auth.authenticated) {
    const returnTo = withLocalePath(`/benefits/${benefitId}`, locale);
    const login = withLocalePath(`/login?returnTo=${encodeURIComponent(returnTo)}`, locale);
    return <FanState kind="auth" title={copy[locale].heading} actions={<FanAction variant="primary" href={login}>{copy[locale].login}</FanAction>} />;
  }
  if (resource.state.status === "loading") return <FanState kind="loading" title={copy[locale].loading} />;
  if (resource.state.status === "error") return <FanState kind="error" title={copy[locale].error} description={copy[locale].errorHelp} actions={<FanAction variant="neutral" onClick={resource.retry} leadingIcon={<RotateCcw />}>{copy[locale].retry}</FanAction>} />;
  return <RaffleResultPanel result={resource.state.data} locale={locale} embedded={embedded} />;
}
