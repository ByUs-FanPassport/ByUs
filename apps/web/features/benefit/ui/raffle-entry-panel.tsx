"use client";

import { messages as localizedMessages } from "@/i18n/catalogs/features__benefit__ui__raffle-entry-panel";
import { translate } from "@/i18n/messages";
import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { BanksyOutboundLinks } from "@/features/analytics/client/banksy-campaign";
import { BANKSY_BENEFIT_IDS } from "@/features/analytics/domain/banksy-campaign";

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
import { creatorRafflesHref, creatorRaffleVerificationHref } from "../domain/raffle-navigation";
import { useRaffleEntry, type RaffleEntryError } from "./use-raffle-entry";
import styles from "./creator-raffles-screen.module.css";

type Props = {
  celebrity: PublishedCelebrity; locale: AppLocale; raffle: RaffleList["raffles"][number];
  benefit: BenefitCatalogItem | null; loading: boolean; loadFailed: boolean;
  status: RaffleList["raffles"][number]["status"]; refresh: () => void;
  onAccepted: (result: BenefitEntryResult) => void;
  onReconciled: (benefit: BenefitCatalogItem) => void;
};

export function raffleEntryErrorText(error: RaffleEntryError | null, locale: AppLocale) {
  const ko = locale === "ko";
  return error === "uncertain" ? (locale === "ko" ? "접수 결과를 아직 확인하지 못했어요. 같은 요청을 다시 확인해 주세요." : translate(locale, localizedMessages.m06251a41fbb6, "The entry result is unconfirmed. Check the same request again."))
    : error === "storage" ? (locale === "ko" ? "이 브라우저에 응모 요청을 안전하게 저장하지 못했어요. 저장 공간이나 브라우저 설정을 확인한 뒤 같은 요청을 다시 시도해 주세요." : translate(locale, localizedMessages.m656dedd53da5, "We couldn't safely save this entry request in your browser. Check your storage or browser settings, then retry the same request."))
    : error === "unavailable" ? (locale === "ko" ? "응모를 시작하지 못했어요. 같은 요청으로 다시 시도해 주세요." : translate(locale, localizedMessages.meeacd6e08569, "We couldn't start the entry. Try the same request again."))
    : error === "reconcile" ? (locale === "ko" ? "접수는 완료됐지만 최신 잔액을 확인하지 못했어요." : translate(locale, localizedMessages.m856535031dbf, "Your entry was accepted, but the current balance could not be checked."))
    : error === "policy" ? (locale === "ko" ? "수령 조건이 변경됐어요. 최신 조건을 확인하고 다시 동의해 주세요." : translate(locale, localizedMessages.m3f35ee31c67e, "The delivery conditions changed. Review the latest conditions and confirm again."))
    : error === "auth" ? (locale === "ko" ? "로그인 상태를 확인한 뒤 다시 시도해 주세요." : translate(locale, localizedMessages.m240f0f9ec45b, "Check your sign-in status and try again."))
    : error === "rejected" ? (locale === "ko" ? "응모가 접수되지 않았어요. 잔액과 응모 조건을 다시 확인해 주세요." : translate(locale, localizedMessages.mef16df2d84a7, "The entry was not accepted. Check your balance and entry conditions.")) : null;
}

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
  const needsVerification = (entry?.requiresFanVerification || raffle.requiresFanVerification) && entry?.fanVerified !== true;
  const canEnter = !needsVerification && status === "open" && entry?.canEnter === true && amount > 0 && acknowledged && !locked && !loadFailed;
  const hasReceipt = request.receipt !== null;
  useEffect(() => {
    if (request.receipt) receiptRef.current?.focus();
    else if (previousReceiptRef.current) entryHeadingRef.current?.focus();
    previousReceiptRef.current = request.receipt?.entryId;
  }, [request.receipt]);
  const errorText = raffleEntryErrorText(request.error, locale);
  const blockedText = status !== "open" ? (status === "preparing" ? (locale === "ko" ? "아직 응모 기간이 아니에요." : translate(locale, localizedMessages.m08b79fa26cb3, "Entries have not opened yet.")) : status === "cancelled" ? (locale === "ko" ? "취소된 응모예요." : translate(locale, localizedMessages.m7ed77945694a, "This raffle was cancelled.")) : (locale === "ko" ? "응모가 마감됐어요." : translate(locale, localizedMessages.mb38b7bc53e41, "Entries are closed.")))
    : balance === 0 ? (locale === "ko" ? "현재 보유한 응모권이 없어요." : translate(locale, localizedMessages.m56c9577c0e0e, "You have no raffle tickets available."))
    : entry?.remainingBenefitTickets === 0 ? (locale === "ko" ? "이 선물의 응모 한도에 도달했어요." : translate(locale, localizedMessages.m3e3c769767ef, "You have reached this gift’s entry limit."))
    : entry && !entry.canEnter ? (locale === "ko" ? "현재 이 선물에 응모할 수 없어요." : translate(locale, localizedMessages.mb2ed417b0509, "You cannot enter this gift right now.")) : null;

  async function confirm() {
    if (confirmAmount === null || confirmAmount < 1 || confirmAmount > limit || !canEnter) return;
    await request.submit({ ticketAmount: confirmAmount, ...(policy ? { policyAcknowledgment: { policyVersion: policy.version, canReceiveInKorea: needsAck && acknowledged } } : {}) });
  }

  return <>
    <section className={styles.entryPanel} aria-labelledby="raffle-entry-title">
      {hasReceipt ? <div className={styles.receipt} key={request.receipt!.entryId}>
        <div className={styles.receiptMotion} aria-hidden="true"><Ticket className={styles.flyingTicket} /><span className={styles.receiptStamp}><Check /></span><i className={styles.spark} /></div>
        <div role="status" aria-live="polite" aria-atomic="true"><span className={styles.eyebrow}>ENTRY RECEIVED</span><h2 id="raffle-entry-title" tabIndex={-1} ref={receiptRef}>{locale === "ko" ? "응모가 완료됐어요" : translate(locale, localizedMessages.m4cf469a3dee0, "Your entry is confirmed")}</h2><p>{raffle.title} · {locale === "ko" ? `${request.receipt!.ticketAmount}장 접수` : translate(locale, localizedMessages.m73c78fdbe5a7, "{0} tickets entered", [request.receipt!.ticketAmount])}</p></div>
        <dl className={styles.receiptFacts}><div><dt>{locale === "ko" ? "이 선물에 응모한 수량" : translate(locale, localizedMessages.m61373ae9ba62, "Tickets entered for this gift")}</dt><dd>{request.receipt!.replayed && !request.reconciled ? "—" : (entry?.enteredTickets ?? (request.receipt!.replayed ? "—" : request.receipt!.benefitTicketTotal))}{ko ? "장" : ""}</dd></div><div><dt>{locale === "ko" ? "남은 응모권" : translate(locale, localizedMessages.m68bd7511833d, "Tickets remaining")}</dt><dd>{request.receipt!.replayed && !request.reconciled ? "—" : (balance ?? (request.receipt!.replayed ? "—" : request.receipt!.resultingBalance))}{ko ? "장" : ""}</dd></div></dl>
        <p>{locale === "ko" ? "당첨 여부는 결과 발표 후 내 응모 내역에서 확인할 수 있어요." : translate(locale, localizedMessages.me5c736e8c93f, "Check your raffle entries for the result after the announcement.")}</p>
        {request.reconciling ? <p role="status">{locale === "ko" ? "최신 응모권 잔액을 확인하고 있어요." : translate(locale, localizedMessages.mbb4518651f9d, "Checking your current ticket balance.")}</p> : null}
        <div className={styles.receiptActions}><FanAction variant="primary" href={creatorRafflesHref(celebrity.slug, locale)} trailingIcon={<ArrowRight />}>{locale === "ko" ? "선물 목록 보기" : translate(locale, localizedMessages.macf06e98e637, "View gifts")}</FanAction><FanAction disabled={!request.reconciled} onClick={() => { request.clearReceipt(); setQuantity(1); }}>{locale === "ko" ? "이 선물에 더 응모하기" : translate(locale, localizedMessages.m2ea442c9ad2e, "Enter this gift again")}</FanAction></div>
        {celebrity.slug === "elina" && raffle.benefitId && BANKSY_BENEFIT_IDS.has(raffle.benefitId) ? <BanksyOutboundLinks locale={locale} surface="raffle_receipt" /> : null}
      </div> : <>
        <div className={styles.entryHeading}><div><span className={styles.eyebrow}>{locale === "ko" ? "01 수량 선택 → 02 확인 → 03 응모 완료" : translate(locale, localizedMessages.m2e78dac5839b, "01 Select tickets → 02 Review → 03 Entry confirmed")}</span><h2 id="raffle-entry-title" tabIndex={-1} ref={entryHeadingRef}>{needsVerification ? (locale === "ko" ? "팬 인증 후 응모해요" : translate(locale, localizedMessages.m74e21ff88376, "Verify your fan status to enter")) : (locale === "ko" ? "이번 선물에 몇 장을 보낼까요?" : translate(locale, localizedMessages.md89436236f21, "How many tickets for this gift?"))}</h2></div>{auth.authenticated ? <p>{locale === "ko" ? "이 선물에 응모한 수량" : translate(locale, localizedMessages.m2b7c808f62dd, "Tickets entered")} <strong>{entry ? `${entry.enteredTickets}${ko ? "장" : ""}` : "—"}</strong></p> : null}</div>
        {!auth.ready || (auth.authenticated && loading) ? <p role="status">{locale === "ko" ? "내 응모권을 확인하고 있어요." : translate(locale, localizedMessages.m43236c59bcd6, "Checking your tickets.")}</p> : !auth.authenticated ? <div className={styles.guestEntry}><p>{locale === "ko" ? "로그인하고 보유 응모권을 확인해 주세요." : translate(locale, localizedMessages.m7613043ebbf0, "Sign in to check your available tickets.")}</p>{status === "open" ? <AuthIntentLink locale={locale} className={fanActionClassName("primary")} emphasis="primary" input={{ sourcePath: `/c/${celebrity.slug}/raffles/${raffle.benefitId}`, sourceQuery: `?locale=${locale}`, actionType: "APPLY_BENEFIT", targetType: "benefit", targetId: raffle.benefitId! }}>{locale === "ko" ? "로그인하고 응모하기" : translate(locale, localizedMessages.m67a4375e9d22, "Sign in to enter")}</AuthIntentLink> : <p>{blockedText}</p>}</div> : loadFailed || !entry ? <div role="status"><p>{locale === "ko" ? "내 응모권을 불러오지 못했어요." : translate(locale, localizedMessages.mdedc8863d69a, "We couldn’t load your tickets.")}</p><FanAction onClick={refresh}>{locale === "ko" ? "다시 확인" : translate(locale, localizedMessages.mdd8786f9f42a, "Try again")}</FanAction></div> : needsVerification && status === "open" ? <div className={styles.guestEntry}><p>{locale === "ko" ? `${celebrity.name} 팬 인증을 완료하면 응모권 1장을 받아 응모할 수 있어요.` : translate(locale, localizedMessages.m0dc40d19d2b2, "Verify your {0} fan status to receive 1 ticket and enter.", [celebrity.name])}</p><FanAction variant="primary" href={creatorRaffleVerificationHref(celebrity.slug, locale, raffle.benefitId)}>{locale === "ko" ? "팬 인증하고 응모권 받기" : translate(locale, localizedMessages.m4348c066a51a, "Verify your fan status")}</FanAction></div> : <>
          <div className={styles.entryColumns}><div><p className={styles.balanceLabel}>{celebrity.name} {locale === "ko" ? `응모권 ${balance}장 보유` : translate(locale, localizedMessages.m8be27e2b94a3, "tickets available: {0}", [balance])}</p><div className={styles.tickets}>
            {balance! <= 8 ? Array.from({ length: balance! }, (_, index) => <button type="button" key={index} className={styles.ticket} aria-pressed={index < amount} aria-label={locale === "ko" ? `응모권 ${index + 1}장 선택` : translate(locale, localizedMessages.m517b0025e2f8, "Select {0} tickets", [index + 1])} disabled={locked || index >= limit || status !== "open"} onClick={() => setQuantity(index === amount - 1 ? amount - 1 : index + 1)}><span><Ticket aria-hidden="true" />{index < amount ? <Check aria-hidden="true" /> : null}</span><small>{celebrity.name} · TICKET {String(index + 1).padStart(2, "0")}</small><strong>{index < amount ? (locale === "ko" ? "이 선물에 사용할 1장" : translate(locale, localizedMessages.me0a90daec87d, "1 ticket for this gift")) : (locale === "ko" ? "남겨 둘 1장" : translate(locale, localizedMessages.me65872f01380, "1 ticket to keep"))}</strong></button>) : <><div className={`${styles.ticket} ${styles.selectedTicket}`}><Ticket aria-hidden="true" /><strong>{locale === "ko" ? `이 선물에 사용할 ${amount}장` : translate(locale, localizedMessages.mdc0f76e5a201, "{0} tickets for this gift", [amount])}</strong></div><div className={styles.ticket}><Ticket aria-hidden="true" /><strong>{locale === "ko" ? `남겨 둘 ${balance! - amount}장` : translate(locale, localizedMessages.m90b2a31f5d04, "{0} tickets to keep", [balance! - amount])}</strong></div></>}
          </div><p className={styles.small}>{locale === "ko" ? "응모권을 눌러 선택하거나 수량을 조절해요." : translate(locale, localizedMessages.mec009adf8387, "Select your tickets or adjust the quantity.")}</p></div><div className={styles.quantityPanel}><div className={styles.quantityLabel}><label htmlFor="raffle-quantity">{locale === "ko" ? "사용할 응모권" : translate(locale, localizedMessages.m7d1c769b8495, "Tickets to use")}</label><button type="button" disabled={locked || limit === 0 || status !== "open"} onClick={() => setQuantity(limit)}>{locale === "ko" ? "모두 사용" : translate(locale, localizedMessages.mb09a0fff55be, "Use all")}</button></div><div className={styles.stepper}><button type="button" aria-label={locale === "ko" ? "응모권 1장 줄이기" : translate(locale, localizedMessages.m5d8ae3e51214, "Use one fewer ticket")} disabled={locked || amount === 0 || status !== "open"} onClick={() => setQuantity(amount - 1)}><Minus aria-hidden="true" /></button><input id="raffle-quantity" type="number" inputMode="numeric" min={0} max={limit} step={1} value={amount} disabled={locked || status !== "open"} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) setQuantity(Math.max(0, Math.min(Math.trunc(next), limit))); }} /><button type="button" aria-label={locale === "ko" ? "응모권 1장 늘리기" : translate(locale, localizedMessages.m2703e4afc870, "Use one more ticket")} disabled={locked || amount >= limit || status !== "open"} onClick={() => setQuantity(amount + 1)}><Plus aria-hidden="true" /></button></div><p className={styles.afterBalance}><span>{locale === "ko" ? "응모 후 남는 응모권" : translate(locale, localizedMessages.m5cb12808d630, "Balance after entry")}</span><strong>{balance} → {balance! - amount}{ko ? "장" : ""}</strong></p>
            {needsAck ? <label className={styles.acknowledgment}><input type="checkbox" checked={acknowledged} disabled={locked} onChange={(event) => setAckVersion(event.target.checked ? policy!.version : null)} /><span>{locale === "ko" ? "대한민국 내 주소로 받을 수 있음을 확인했습니다." : translate(locale, localizedMessages.m9f532b6cb5af, "I confirm that I can receive this prize at an address in South Korea.")}</span></label> : null}
            {blockedText ? <p role="status">{blockedText}</p> : null}<FanAction fullWidth variant="primary" disabled={!canEnter} onClick={() => setConfirmAmount(amount)} trailingIcon={<ArrowRight />}>{request.pending ? (locale === "ko" ? "응모 접수 중" : translate(locale, localizedMessages.m8148277bcf10, "Submitting entry")) : (locale === "ko" ? `${amount}장으로 응모하기` : translate(locale, localizedMessages.mb41f3ae17fe8, "Enter with {0} tickets", [amount]))}</FanAction>
          </div></div><div className={styles.entryFoot}><span>{locale === "ko" ? "다음 화면에서 확인한 뒤 응모권이 차감돼요." : translate(locale, localizedMessages.m012d9e10a42a, "Tickets are deducted after you confirm on the next screen.")}</span><span>{entry.perFanTicketLimit === null ? (locale === "ko" ? "응모 한도 없음" : translate(locale, localizedMessages.md178b3a4f860, "No per-gift limit")) : (locale === "ko" ? `이 선물의 응모 한도 ${entry.perFanTicketLimit}장` : translate(locale, localizedMessages.m5e1fc0e3fcaf, "Limit: {0} tickets", [entry.perFanTicketLimit]))} · {celebrity.name} {locale === "ko" ? "응모권 전용" : translate(locale, localizedMessages.m03c9d1eac3c2, "tickets only")}</span></div>
        </>}
      </>}
      {errorText ? <div className={styles.error} role="alert"><p>{errorText}</p></div> : null}
      {request.unresolvedRequest && !hasReceipt ? <div className={styles.notice}><p>{locale === "ko" ? `확인할 요청: ${request.unresolvedRequest.ticketAmount}장` : translate(locale, localizedMessages.m6703bf407a9c, "Request to check: {0} tickets", [request.unresolvedRequest.ticketAmount])}</p><FanAction disabled={request.pending} onClick={() => void request.retry()}>{locale === "ko" ? "같은 응모 요청 확인" : translate(locale, localizedMessages.m33fb325bbfb8, "Check the same entry")}</FanAction></div> : null}
      {request.error === "reconcile" ? <FanAction disabled={request.reconciling} onClick={() => void request.retryReconciliation()}>{locale === "ko" ? "최신 잔액 다시 확인" : translate(locale, localizedMessages.mcded85602172, "Check current balance")}</FanAction> : null}
      {request.error === "policy" || request.error === "rejected" ? <FanAction onClick={() => { setConfirmAmount(null); setAckVersion(null); refresh(); }}>{locale === "ko" ? "응모 조건 다시 확인" : translate(locale, localizedMessages.m958a91a53c01, "Refresh entry conditions")}</FanAction> : null}
    </section>
    <section className={styles.afterEntry}><h2>{locale === "ko" ? "응모 후에는 이렇게 진행돼요" : translate(locale, localizedMessages.m971f555fb08c, "What happens after you enter")}</h2><div><article><span>01</span><h3>{locale === "ko" ? "응모 완료" : translate(locale, localizedMessages.m4c6ee1c5aa01, "Entry confirmed")}</h3><p>{locale === "ko" ? "선택한 수량만큼 응모권이 차감돼요." : translate(locale, localizedMessages.m6beed93d5644, "Only the confirmed number of tickets is deducted.")}</p></article><article><span>02</span><h3>{locale === "ko" ? "내 응모에서 결과 확인" : translate(locale, localizedMessages.m104bb9e8a185, "Check your raffle result")}</h3><p>{locale === "ko" ? "결과가 발표되면 당첨 여부를 확인해요." : translate(locale, localizedMessages.m183a6d28ddbd, "Check your result after the announcement.")}</p></article><article><span>03</span><h3>{locale === "ko" ? "당첨되면 선물 받기" : translate(locale, localizedMessages.m7c67e591a65f, "Receive your prize if selected")}</h3><p>{policy && raffle.fulfillmentMethod !== "digital" ? (locale === "ko" ? `발표 후 ${policy.recipientWindowDays}일 안에 수령 정보를 입력해요.` : translate(locale, localizedMessages.m5240c462a6a6, "Submit recipient details within {0} days of the announcement.", [policy.recipientWindowDays])) : (locale === "ko" ? "내 응모 내역의 수령 안내를 확인해요." : translate(locale, localizedMessages.mf3ceb0dbc1ee, "Follow the delivery instructions in your raffle entries."))}</p></article></div>{needsAck ? <p className={styles.notice}>{locale === "ko" ? "한국 주소로만 배송해요. 해외 배송은 지원하지 않습니다." : translate(locale, localizedMessages.m6e6dc3d8bfe0, "Shipping is available only to addresses in South Korea.")}</p> : null}{policy?.pickupInstructions[toContentLocale(locale)] ? <p className={styles.notice}>{policy.pickupInstructions[toContentLocale(locale)]}</p> : null}</section>
    <AlertDialog open={confirmAmount !== null && !hasReceipt} onClose={() => { if (!request.pending) setConfirmAmount(null); }} labelledBy="raffle-confirm-title" describedBy="raffle-confirm-help" busy={request.pending} closeOnEscape={!request.pending} closeOnBackdrop={!request.pending} initialFocusRef={cancelRef} backdropClassName={styles.dialogBackdrop} contentClassName={styles.dialog}>
      <span className={styles.eyebrow}>{locale === "ko" ? "응모권 사용 확인" : translate(locale, localizedMessages.m624decf92981, "REVIEW YOUR ENTRY")}</span><h2 id="raffle-confirm-title">{locale === "ko" ? `${confirmAmount ?? amount}장으로 응모할까요?` : translate(locale, localizedMessages.mc80c83cf88e6, "Enter with {0} tickets?", [confirmAmount ?? amount])}</h2><p id="raffle-confirm-help">{raffle.title}<br />{locale === "ko" ? "확정하면 응모권이 즉시 차감돼요." : translate(locale, localizedMessages.ma1192816cc37, "Your tickets will be deducted when you confirm.")}</p><dl className={styles.facts}><div><dt>{locale === "ko" ? "현재 보유" : translate(locale, localizedMessages.m2a8bcbd514ef, "Available now")}</dt><dd>{balance ?? "—"}</dd></div><div><dt>{locale === "ko" ? "이번 응모" : translate(locale, localizedMessages.me5b902560fe0, "This entry")}</dt><dd>−{confirmAmount}</dd></div><div><dt>{locale === "ko" ? "응모 후 잔액" : translate(locale, localizedMessages.m404a4ce1070d, "Balance after entry")}</dt><dd>{balance === undefined ? "—" : Math.max(0, balance - (confirmAmount ?? 0))}</dd></div></dl>{errorText ? <p role="alert">{errorText}</p> : null}<div className={styles.dialogActions}><button type="button" className={fanActionClassName("neutral")} ref={cancelRef} disabled={request.pending} onClick={() => setConfirmAmount(null)}>{request.unresolvedRequest ? (locale === "ko" ? "닫기" : translate(locale, localizedMessages.m1844bff88b3f, "Close")) : (locale === "ko" ? "수량 다시 선택" : translate(locale, localizedMessages.mc03cf76d1cd6, "Change quantity"))}</button>{request.unresolvedRequest ? <FanAction variant="primary" disabled={request.pending} ariaBusy={request.pending} onClick={() => void request.retry()}>{request.pending ? (locale === "ko" ? "응모 접수 중" : translate(locale, localizedMessages.m6ebbd108e528, "Submitting")) : (locale === "ko" ? "같은 응모 요청 확인" : translate(locale, localizedMessages.m33fb325bbfb8, "Check the same entry"))}</FanAction> : <FanAction variant="primary" disabled={request.pending || !canEnter || (confirmAmount ?? 0) > limit} ariaBusy={request.pending} onClick={() => void confirm()}>{request.pending ? (locale === "ko" ? "응모 접수 중" : translate(locale, localizedMessages.m6ebbd108e528, "Submitting")) : (locale === "ko" ? "응모 확정" : translate(locale, localizedMessages.m68b4aca03c6e, "Confirm entry"))}</FanAction>}</div>
    </AlertDialog>
  </>;
}
