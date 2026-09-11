"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Check, Minus, Plus, Ticket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { FanAction, fanActionClassName } from "@/components/fan-ui/fan-action";
import { AlertDialog } from "@/components/ui/overlay/accessible-overlay";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import type { BenefitCatalogItem } from "../domain/benefit";
import type { BenefitEntryResult } from "../domain/benefit-entry";
import type { RaffleList } from "../domain/raffle";
import { creatorRafflesHref } from "../domain/raffle-navigation";
import { useRaffleEntry } from "./use-raffle-entry";
import styles from "./creator-raffles-screen.module.css";

type Props = {
  celebrity: PublishedCelebrity; locale: "ko" | "en"; raffle: RaffleList["raffles"][number];
  benefit: BenefitCatalogItem | null; loading: boolean; loadFailed: boolean;
  status: RaffleList["raffles"][number]["status"]; refresh: () => void;
  onAccepted: (result: BenefitEntryResult) => void;
  onReconciled: (benefit: BenefitCatalogItem) => void;
};

export function RaffleEntryPanel({ celebrity, locale, raffle, benefit, loading, loadFailed, status, refresh, onAccepted, onReconciled }: Props) {
  const auth = usePrivy();
  const ko = locale === "ko";
  const [quantity, setQuantity] = useState(1);
  const [confirmAmount, setConfirmAmount] = useState<number | null>(null);
  const [ackVersion, setAckVersion] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const receiptRef = useRef<HTMLHeadingElement>(null);
  const entryHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousReceiptRef = useRef<string | undefined>(undefined);
  const entry = benefit?.entry;
  const balance = entry?.creatorTicketBalance;
  const limit = Math.min(balance ?? 0, entry?.remainingBenefitTickets ?? Infinity);
  const amount = Math.max(0, Math.min(quantity, limit));
  const policy = entry?.fulfillmentPolicy ?? raffle.fulfillmentPolicy;
  const needsAck = policy?.requiresShippingAcknowledgment === true;
  const acknowledged = !needsAck || ackVersion === policy?.version;
  const request = useRaffleEntry({
    ownerId: auth.ready && auth.authenticated ? auth.user?.id ?? null : null,
    benefitId: raffle.benefitId!, locale, getAccessToken: auth.getAccessToken,
    onAccepted: (result) => { setConfirmAmount(null); onAccepted(result); }, onReconciled,
  });
  const locked = request.pending || request.unresolvedRequest !== null || request.receipt !== null;
  const canEnter = status === "open" && entry?.canEnter === true && amount > 0 && acknowledged && !locked && !loadFailed;
  const hasReceipt = request.receipt !== null;
  useEffect(() => {
    if (request.receipt) receiptRef.current?.focus();
    else if (previousReceiptRef.current) entryHeadingRef.current?.focus();
    previousReceiptRef.current = request.receipt?.entryId;
  }, [request.receipt]);
  const errorText = request.error === "uncertain" ? (ko ? "접수 결과를 아직 확인하지 못했어요. 같은 요청을 다시 확인해 주세요." : "The entry result is unconfirmed. Check the same request again.")
    : request.error === "reconcile" ? (ko ? "접수는 완료됐지만 최신 잔액을 확인하지 못했어요." : "Your entry was accepted, but the current balance could not be checked.")
    : request.error === "policy" ? (ko ? "수령 조건이 변경됐어요. 최신 조건을 확인하고 다시 동의해 주세요." : "The delivery conditions changed. Review the latest conditions and confirm again.")
    : request.error === "auth" ? (ko ? "로그인 상태를 확인한 뒤 다시 시도해 주세요." : "Check your sign-in status and try again.")
    : request.error === "rejected" ? (ko ? "응모가 접수되지 않았어요. 잔액과 응모 조건을 다시 확인해 주세요." : "The entry was not accepted. Check your balance and entry conditions.") : null;
  const blockedText = status !== "open" ? (status === "preparing" ? (ko ? "아직 응모 기간이 아니에요." : "Entries have not opened yet.") : status === "cancelled" ? (ko ? "취소된 응모예요." : "This raffle was cancelled.") : (ko ? "응모가 마감됐어요." : "Entries are closed."))
    : balance === 0 ? (ko ? "현재 보유한 응모권이 없어요." : "You have no raffle tickets available.")
    : entry?.remainingBenefitTickets === 0 ? (ko ? "이 선물의 응모 한도에 도달했어요." : "You have reached this gift’s entry limit.")
    : entry && !entry.canEnter ? (ko ? "현재 이 선물에 응모할 수 없어요." : "You cannot enter this gift right now.") : null;

  async function confirm() {
    if (confirmAmount === null || confirmAmount < 1 || confirmAmount > limit || !canEnter) return;
    await request.submit({ ticketAmount: confirmAmount, ...(policy ? { policyAcknowledgment: { policyVersion: policy.version, canReceiveInKorea: needsAck && acknowledged } } : {}) });
  }

  return <>
    <section className={styles.entryPanel} aria-labelledby="raffle-entry-title">
      {hasReceipt ? <div className={styles.receipt} key={request.receipt!.entryId}>
        <div className={styles.receiptMotion} aria-hidden="true"><Ticket className={styles.flyingTicket} /><span className={styles.receiptStamp}><Check /></span><i className={styles.spark} /></div>
        <div role="status" aria-live="polite" aria-atomic="true"><span className={styles.eyebrow}>ENTRY RECEIVED</span><h2 id="raffle-entry-title" tabIndex={-1} ref={receiptRef}>{ko ? "응모가 완료됐어요" : "Your entry is confirmed"}</h2><p>{raffle.title} · {ko ? `${request.receipt!.ticketAmount}장 접수` : `${request.receipt!.ticketAmount} tickets entered`}</p></div>
        <dl className={styles.receiptFacts}><div><dt>{ko ? "이 선물에 응모한 수량" : "Tickets entered for this gift"}</dt><dd>{request.receipt!.replayed && !request.reconciled ? "—" : (entry?.enteredTickets ?? (request.receipt!.replayed ? "—" : request.receipt!.benefitTicketTotal))}{ko ? "장" : ""}</dd></div><div><dt>{ko ? "남은 응모권" : "Tickets remaining"}</dt><dd>{request.receipt!.replayed && !request.reconciled ? "—" : (balance ?? (request.receipt!.replayed ? "—" : request.receipt!.resultingBalance))}{ko ? "장" : ""}</dd></div></dl>
        <p>{ko ? "당첨 여부는 결과 발표 후 내 응모 내역에서 확인할 수 있어요." : "Check your raffle entries for the result after the announcement."}</p>
        {request.reconciling ? <p role="status">{ko ? "최신 응모권 잔액을 확인하고 있어요." : "Checking your current ticket balance."}</p> : null}
        <div className={styles.receiptActions}><FanAction variant="primary" href={creatorRafflesHref(celebrity.slug, locale)} trailingIcon={<ArrowRight />}>{ko ? "선물 목록 보기" : "View gifts"}</FanAction><FanAction disabled={!request.reconciled} onClick={() => { request.clearReceipt(); setQuantity(1); }}>{ko ? "이 선물에 더 응모하기" : "Enter this gift again"}</FanAction></div>
      </div> : <>
        <div className={styles.entryHeading}><div><span className={styles.eyebrow}>{ko ? "01 수량 선택 → 02 확인 → 03 응모 완료" : "01 Select tickets → 02 Review → 03 Entry confirmed"}</span><h2 id="raffle-entry-title" tabIndex={-1} ref={entryHeadingRef}>{ko ? "이번 선물에 몇 장을 보낼까요?" : "How many tickets for this gift?"}</h2></div>{auth.authenticated ? <p>{ko ? "이 선물에 응모한 수량" : "Tickets entered"} <strong>{entry ? `${entry.enteredTickets}${ko ? "장" : ""}` : "—"}</strong></p> : null}</div>
        {!auth.ready || (auth.authenticated && loading) ? <p role="status">{ko ? "내 응모권을 확인하고 있어요." : "Checking your tickets."}</p> : !auth.authenticated ? <div className={styles.guestEntry}><p>{ko ? "로그인하고 보유 응모권을 확인해 주세요." : "Sign in to check your available tickets."}</p>{status === "open" ? <AuthIntentLink locale={locale} className={fanActionClassName("primary")} emphasis="primary" input={{ sourcePath: `/c/${celebrity.slug}/raffles/${raffle.benefitId}`, sourceQuery: `?locale=${locale}`, actionType: "APPLY_BENEFIT", targetType: "benefit", targetId: raffle.benefitId! }}>{ko ? "로그인하고 응모하기" : "Sign in to enter"}</AuthIntentLink> : <p>{blockedText}</p>}</div> : loadFailed || !entry ? <div role="status"><p>{ko ? "내 응모권을 불러오지 못했어요." : "We couldn’t load your tickets."}</p><FanAction onClick={refresh}>{ko ? "다시 확인" : "Try again"}</FanAction></div> : <>
          <div className={styles.entryColumns}><div><p className={styles.balanceLabel}>{celebrity.name} {ko ? `응모권 ${balance}장 보유` : `tickets available: ${balance}`}</p><div className={styles.tickets}>
            {balance! <= 8 ? Array.from({ length: balance! }, (_, index) => <button type="button" key={index} className={styles.ticket} aria-pressed={index < amount} aria-label={ko ? `응모권 ${index + 1}장 선택` : `Select ${index + 1} tickets`} disabled={locked || index >= limit || status !== "open"} onClick={() => setQuantity(index === amount - 1 ? amount - 1 : index + 1)}><span><Ticket aria-hidden="true" />{index < amount ? <Check aria-hidden="true" /> : null}</span><small>{celebrity.name} · TICKET {String(index + 1).padStart(2, "0")}</small><strong>{index < amount ? (ko ? "이 선물에 사용할 1장" : "1 ticket for this gift") : (ko ? "남겨 둘 1장" : "1 ticket to keep")}</strong></button>) : <><div className={`${styles.ticket} ${styles.selectedTicket}`}><Ticket aria-hidden="true" /><strong>{ko ? `이 선물에 사용할 ${amount}장` : `${amount} tickets for this gift`}</strong></div><div className={styles.ticket}><Ticket aria-hidden="true" /><strong>{ko ? `남겨 둘 ${balance! - amount}장` : `${balance! - amount} tickets to keep`}</strong></div></>}
          </div><p className={styles.small}>{ko ? "응모권을 눌러 선택하거나 수량을 조절해요." : "Select your tickets or adjust the quantity."}</p></div><div className={styles.quantityPanel}><div className={styles.quantityLabel}><label htmlFor="raffle-quantity">{ko ? "사용할 응모권" : "Tickets to use"}</label><button type="button" disabled={locked || limit === 0 || status !== "open"} onClick={() => setQuantity(limit)}>{ko ? "모두 사용" : "Use all"}</button></div><div className={styles.stepper}><button type="button" aria-label={ko ? "응모권 1장 줄이기" : "Use one fewer ticket"} disabled={locked || amount === 0 || status !== "open"} onClick={() => setQuantity(amount - 1)}><Minus aria-hidden="true" /></button><input id="raffle-quantity" type="number" inputMode="numeric" min={0} max={limit} step={1} value={amount} disabled={locked || status !== "open"} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) setQuantity(Math.max(0, Math.min(Math.trunc(next), limit))); }} /><button type="button" aria-label={ko ? "응모권 1장 늘리기" : "Use one more ticket"} disabled={locked || amount >= limit || status !== "open"} onClick={() => setQuantity(amount + 1)}><Plus aria-hidden="true" /></button></div><p className={styles.afterBalance}><span>{ko ? "응모 후 남는 응모권" : "Balance after entry"}</span><strong>{balance} → {balance! - amount}{ko ? "장" : ""}</strong></p>
            {needsAck ? <label className={styles.acknowledgment}><input type="checkbox" checked={acknowledged} disabled={locked} onChange={(event) => setAckVersion(event.target.checked ? policy!.version : null)} /><span>{ko ? "대한민국 내 주소로 받을 수 있음을 확인했습니다." : "I confirm that I can receive this prize at an address in South Korea."}</span></label> : null}
            {blockedText ? <p role="status">{blockedText}</p> : null}<FanAction fullWidth variant="primary" disabled={!canEnter} onClick={() => setConfirmAmount(amount)} trailingIcon={<ArrowRight />}>{request.pending ? (ko ? "응모 접수 중" : "Submitting entry") : (ko ? `${amount}장으로 응모하기` : `Enter with ${amount} tickets`)}</FanAction>
          </div></div><div className={styles.entryFoot}><span>{ko ? "다음 화면에서 확인한 뒤 응모권이 차감돼요." : "Tickets are deducted after you confirm on the next screen."}</span><span>{entry.perFanTicketLimit === null ? (ko ? "응모 한도 없음" : "No per-gift limit") : (ko ? `이 선물의 응모 한도 ${entry.perFanTicketLimit}장` : `Limit: ${entry.perFanTicketLimit} tickets`)} · {celebrity.name} {ko ? "응모권 전용" : "tickets only"}</span></div>
        </>}
      </>}
      {errorText ? <div className={styles.error} role="alert"><p>{errorText}</p></div> : null}
      {request.unresolvedRequest && !hasReceipt ? <div className={styles.notice}><p>{ko ? `확인할 요청: ${request.unresolvedRequest.ticketAmount}장` : `Request to check: ${request.unresolvedRequest.ticketAmount} tickets`}</p><FanAction disabled={request.pending} onClick={() => void request.retry()}>{ko ? "같은 응모 요청 확인" : "Check the same entry"}</FanAction></div> : null}
      {request.error === "reconcile" ? <FanAction disabled={request.reconciling} onClick={() => void request.retryReconciliation()}>{ko ? "최신 잔액 다시 확인" : "Check current balance"}</FanAction> : null}
      {request.error === "policy" || request.error === "rejected" ? <FanAction onClick={() => { setConfirmAmount(null); setAckVersion(null); refresh(); }}>{ko ? "응모 조건 다시 확인" : "Refresh entry conditions"}</FanAction> : null}
    </section>
    <section className={styles.afterEntry}><h2>{ko ? "응모 후에는 이렇게 진행돼요" : "What happens after you enter"}</h2><div><article><span>01</span><h3>{ko ? "응모 완료" : "Entry confirmed"}</h3><p>{ko ? "선택한 수량만큼 응모권이 차감돼요." : "Only the confirmed number of tickets is deducted."}</p></article><article><span>02</span><h3>{ko ? "내 응모에서 결과 확인" : "Check your raffle result"}</h3><p>{ko ? "결과가 발표되면 당첨 여부를 확인해요." : "Check your result after the announcement."}</p></article><article><span>03</span><h3>{ko ? "당첨되면 선물 받기" : "Receive your prize if selected"}</h3><p>{policy && raffle.fulfillmentMethod !== "digital" ? (ko ? `발표 후 ${policy.recipientWindowDays}일 안에 수령 정보를 입력해요.` : `Submit recipient details within ${policy.recipientWindowDays} days of the announcement.`) : (ko ? "내 응모 내역의 수령 안내를 확인해요." : "Follow the delivery instructions in your raffle entries.")}</p></article></div>{needsAck ? <p className={styles.notice}>{ko ? "한국 주소로만 배송해요. 해외 배송은 지원하지 않습니다." : "Shipping is available only to addresses in South Korea."}</p> : null}{policy?.pickupInstructions[locale] ? <p className={styles.notice}>{policy.pickupInstructions[locale]}</p> : null}</section>
    <AlertDialog open={confirmAmount !== null && !hasReceipt} onClose={() => { if (!request.pending) setConfirmAmount(null); }} labelledBy="raffle-confirm-title" describedBy="raffle-confirm-help" busy={request.pending} closeOnEscape={!request.pending} closeOnBackdrop={!request.pending} initialFocusRef={cancelRef} backdropClassName={styles.dialogBackdrop} contentClassName={styles.dialog}>
      <span className={styles.eyebrow}>{ko ? "응모권 사용 확인" : "REVIEW YOUR ENTRY"}</span><h2 id="raffle-confirm-title">{ko ? `${confirmAmount ?? amount}장으로 응모할까요?` : `Enter with ${confirmAmount ?? amount} tickets?`}</h2><p id="raffle-confirm-help">{raffle.title}<br />{ko ? "확정하면 응모권이 즉시 차감돼요." : "Your tickets will be deducted when you confirm."}</p><dl className={styles.facts}><div><dt>{ko ? "현재 보유" : "Available now"}</dt><dd>{balance ?? "—"}</dd></div><div><dt>{ko ? "이번 응모" : "This entry"}</dt><dd>−{confirmAmount}</dd></div><div><dt>{ko ? "응모 후 잔액" : "Balance after entry"}</dt><dd>{balance === undefined ? "—" : Math.max(0, balance - (confirmAmount ?? 0))}</dd></div></dl>{errorText ? <p role="alert">{errorText}</p> : null}<div className={styles.dialogActions}><button type="button" className={fanActionClassName("neutral")} ref={cancelRef} disabled={request.pending} onClick={() => setConfirmAmount(null)}>{ko ? "수량 다시 선택" : "Change quantity"}</button><FanAction variant="primary" disabled={request.pending || !canEnter || (confirmAmount ?? 0) > limit} ariaBusy={request.pending} onClick={() => void confirm()}>{request.pending ? (ko ? "응모 접수 중" : "Submitting") : (ko ? "응모 확정" : "Confirm entry")}</FanAction></div>
    </AlertDialog>
  </>;
}
