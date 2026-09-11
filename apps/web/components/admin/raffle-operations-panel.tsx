"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";

import {
  canTransitionFulfillment,
  type FulfillmentMethod,
  type FulfillmentStatus,
} from "@/features/benefit/domain/fulfillment";
import {
  raffleFulfillmentPolicySchema,
  type RaffleFulfillmentPolicy,
} from "@/features/benefit/domain/raffle-fulfillment-policy";
import styles from "./raffle-operations-panel.module.css";

type Locale = "ko" | "en";
type Request = (path: string, body?: unknown) => Promise<Response>;

const copy = {
  ko: {
    auth: "로그인이 필요합니다.", conflict: "상태가 변경되었거나 처리 조건을 충족하지 않습니다. 새로 조회해 주세요.", failed: "처리하지 못했습니다. 다시 시도해 주세요.",
    policyOpen: "수령 조건 조회·설정", version: "정책 버전", shipping: "대한민국 주소로만 배송 · 응모 전 확인 필수", pickup: "현장 수령 · 성명과 휴대폰 뒤 4자리 확인", digital: "디지털 전달",
    policyHelp: "수령 정보는 실제 당첨 발표부터 7일간 입력할 수 있습니다. 응모가 시작된 정책은 변경할 수 없습니다.", pickupEnd: "방문 수령 종료일 (한국 시간)", venue: "수령 장소", instructions: "수령 안내", policySave: "수령 조건 저장",
    roster: "현장 수령 명단", rosterHelp: "경품·성명·휴대폰 뒤 4자리·수령 상태만 포함합니다.", purpose: "이용 목적", purposeHelp: "명단을 사용하는 이유를 10자 이상 입력해 주세요.", rosterDownload: "명단 CSV 다운로드", rosterDone: "명단을 내려받았습니다. 조회 목적과 명단 버전이 감사 기록에 남았습니다.",
    read: "수령 정보 조회", reveal: "개인정보 보기 · 조회 기록", hide: "정보 숨기기", deadline: "입력 마감", name: "성명", phone: "연락처", address: "배송지", notSubmitted: "수령 정보가 아직 제출되지 않았습니다.", memo: "처리 사유", memoError: "처리 사유를 10자 이상 입력해 주세요.", carrier: "택배사", tracking: "운송장 번호", process: "처리", verify: "현장에서 성명과 휴대폰 뒤 4자리 일치를 확인했습니다.", complete: "수령 완료", review: "확인 필요 기록", close: "미수령으로 종결", closed: "미수령 종결",
    closeConfirm: "미수령으로 종결할까요? 이후 수령 처리가 차단됩니다.", reviewConfirm: "확인이 필요한 건으로 기록할까요? 수령 완료 처리되지 않습니다.", completeConfirm: "성명과 휴대폰 뒤 4자리를 확인했습니다. 수령 완료로 처리할까요?",
  },
  en: {
    auth: "Sign-in is required.", conflict: "The status changed or the operation is no longer allowed. Refresh and try again.", failed: "We couldn’t complete the operation. Try again.",
    policyOpen: "View or configure collection policy", version: "Policy version", shipping: "Ships to Korean addresses only · confirmation required before entry", pickup: "On-site pickup · verify name and last four phone digits", digital: "Digital delivery",
    policyHelp: "Recipients can submit details for seven days after the result is published. A policy cannot change after entries begin.", pickupEnd: "Pickup end date (KST)", venue: "Pickup venue", instructions: "Pickup instructions", policySave: "Save collection policy",
    roster: "Pickup roster", rosterHelp: "Includes only the prize, name, last four phone digits, and collection status.", purpose: "Purpose of use", purposeHelp: "Enter at least 10 characters explaining why this roster is needed.", rosterDownload: "Download roster CSV", rosterDone: "Roster downloaded. The purpose and roster version were recorded in the audit log.",
    read: "View recipient details", reveal: "Reveal personal information · audit access", hide: "Hide information", deadline: "Details due", name: "Name", phone: "Phone", address: "Shipping address", notSubmitted: "Recipient details have not been submitted.", memo: "Operation reason", memoError: "Enter an operation reason of at least 10 characters.", carrier: "Carrier", tracking: "Tracking number", process: "Set", verify: "I confirmed that the name and last four phone digits match at the venue.", complete: "Complete pickup", review: "Record for review", close: "Close as unclaimed", closed: "Closed as unclaimed",
    closeConfirm: "Close this prize as unclaimed? Further collection will be blocked.", reviewConfirm: "Record this case for review? It will not be marked as collected.", completeConfirm: "You confirmed the name and last four phone digits. Mark pickup as complete?",
  },
} as const;

const statusNames: Record<FulfillmentStatus, Record<Locale, string>> = {
  information_required: { ko: "수령 정보 대기", en: "Recipient details required" },
  ready: { ko: "정보 제출 완료", en: "Details received" },
  shipping_preparing: { ko: "배송 준비", en: "Preparing shipment" },
  shipping_in_transit: { ko: "배송 중", en: "In transit" },
  shipping_completed: { ko: "배송 완료", en: "Delivered" },
  pickup_available: { ko: "현장 수령 가능", en: "Ready for pickup" },
  pickup_completed: { ko: "수령 완료", en: "Picked up" },
  digital_delivered: { ko: "전달 완료", en: "Delivered" },
};

function useRequest(locale: Locale): Request {
  const { getAccessToken } = usePrivy();
  const t = copy[locale];
  return async (path, body) => {
    const token = await getAccessToken();
    if (!token) throw new Error(t.auth);
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-correlation-id": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(response.status === 409 ? t.conflict : t.failed);
    return response;
  };
}

export function RafflePolicyEditor({ campaignId, benefitId, title, method, revision, canWrite, onSaved, locale }: {
  campaignId: string; benefitId: string; title: string; method: RaffleFulfillmentPolicy["method"]; revision: number; canWrite: boolean; onSaved(): Promise<void>; locale: Locale;
}) {
  const request = useRequest(locale), t = copy[locale];
  const [policy, setPolicy] = useState<RaffleFulfillmentPolicy | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const result = await (await request(`/api/admin/benefit-campaigns/${campaignId}/policies/${benefitId}`)).json();
      setPolicy(result.policy ? raffleFulfillmentPolicySchema.parse(result.policy) : { version: "raffle-fulfillment-v1", method, shippingCountry: method === "physical_shipping" ? "KR" : null, requiresShippingAcknowledgment: method === "physical_shipping", recipientWindowDays: 7, pickupEndsOn: null, pickupVenue: { ko: "", en: "" }, pickupInstructions: { ko: "", en: "" } });
      setLoaded(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!policy || busy) return; setBusy(true); setError("");
    try { await request(`/api/admin/benefit-campaigns/${campaignId}/policies/${benefitId}`, { expectedRevision: revision, policy }); await onSaved(); setLoaded(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const methodCopy = method === "physical_shipping" ? t.shipping : method === "on_site_pickup" ? t.pickup : t.digital;
  return <div className={styles.panel}>
    <strong>{title}</strong>
    {!loaded ? <button type="button" disabled={busy} onClick={() => void load()}>{t.policyOpen}</button> : policy && <form onSubmit={save}>
      <fieldset disabled={!canWrite || busy}>
        <label>{t.version}<input required maxLength={100} value={policy.version} onChange={e => setPolicy({ ...policy, version: e.target.value })} /></label>
        <p>{methodCopy}</p><p>{t.policyHelp}</p>
        {method === "on_site_pickup" && <>
          <label>{t.pickupEnd}<input type="date" required value={policy.pickupEndsOn ?? ""} onChange={e => setPolicy({ ...policy, pickupEndsOn: e.target.value || null })} /></label>
          {(["ko", "en"] as const).map(lang => <div key={lang} className={styles.grid}>
            <label>{t.venue} ({lang})<input required value={policy.pickupVenue[lang]} onChange={e => setPolicy({ ...policy, pickupVenue: { ...policy.pickupVenue, [lang]: e.target.value } })} /></label>
            <label>{t.instructions} ({lang})<textarea required value={policy.pickupInstructions[lang]} onChange={e => setPolicy({ ...policy, pickupInstructions: { ...policy.pickupInstructions, [lang]: e.target.value } })} /></label>
          </div>)}
        </>}
        <button type="submit">{t.policySave}</button>
      </fieldset>
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

export function PickupRosterExport({ campaignId, canWrite, locale }: { campaignId: string; canWrite: boolean; locale: Locale }) {
  const request = useRequest(locale), t = copy[locale];
  const [purpose, setPurpose] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function download(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (purpose.trim().length < 10) { setError(t.purposeHelp); return; }
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await request(`/api/admin/benefit-campaigns/${campaignId}/pickup-roster`, { purpose: purpose.trim(), format: "csv" });
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = `pickup-${campaignId}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(t.rosterDone);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form className={styles.panel} onSubmit={download}><strong>{t.roster}</strong><p>{t.rosterHelp}</p>
    <label>{t.purpose}<input required minLength={10} maxLength={1000} disabled={!canWrite || busy} value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
    <button disabled={!canWrite || busy}>{t.rosterDownload}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}

type WinnerDetail = { winnerId: string; method: FulfillmentMethod; status: FulfillmentStatus; revision: number; recipientDeadlineAt?: string | null; claimDisposition?: "active" | "unclaimed"; recipient?: null | { name: string; phone: string; address1?: string; address2?: string; postalCode?: string; masked?: boolean } };
const allStatuses = Object.keys(statusNames) as FulfillmentStatus[];
const currentTimestamp = () => Date.now();

export function RaffleWinnerOperations({ winnerId, title, status, canWrite, published, onSaved, locale }: { winnerId: string; title: string; status: string; canWrite: boolean; published: boolean; onSaved(): Promise<void>; locale: Locale }) {
  const request = useRequest(locale), t = copy[locale];
  const [detail, setDetail] = useState<WinnerDetail | null>(null), [loadedAt, setLoadedAt] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [memo, setMemo] = useState(""), [verified, setVerified] = useState(false), [carrier, setCarrier] = useState(""), [tracking, setTracking] = useState("");
  async function load(reveal = false) { const next = await (await request(`/api/admin/benefit-winners/${winnerId}?reveal=${reveal}`)).json() as WinnerDetail; setDetail(next); setLoadedAt(currentTimestamp()); setVerified(false); }
  async function show(reveal: boolean) { setBusy(true); setError(""); try { await load(reveal); } catch (e) { setDetail(null); setVerified(false); setError((e as Error).message); } finally { setBusy(false); } }
  async function act(toStatus: FulfillmentStatus | null, manualReview = false, close = false) {
    if (!detail || busy) return;
    if (toStatus === "pickup_completed" && !manualReview && !verified) return;
    if (memo.trim().length < 10) { setError(t.memoError); return; }
    if ((close || toStatus === "pickup_completed") && !window.confirm(close ? t.closeConfirm : manualReview ? t.reviewConfirm : t.completeConfirm)) return;
    setBusy(true); setError("");
    try {
      await request(`/api/admin/benefit-winners/${winnerId}${close ? "/close" : ""}`, close ? { expectedRevision: detail.revision, reason: memo.trim() } : {
        expectedRevision: detail.revision, toStatus, operatorMemo: memo.trim(),
        ...(toStatus === "shipping_in_transit" ? { carrier, trackingNumber: tracking } : {}),
        ...(toStatus === "pickup_completed" ? { verificationMethod: "name_phone_last4", verificationOutcome: manualReview ? "manual_review" : "matched" } : {}),
      });
      setMemo(""); await load(); await onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const closed = detail?.claimDisposition === "unclaimed";
  const canClose = Boolean(detail && !closed && detail.recipientDeadlineAt && loadedAt >= Date.parse(detail.recipientDeadlineAt) && detail.status === "information_required");
  const nextStatuses = detail ? allStatuses.filter(next => canTransitionFulfillment(detail.method, detail.status, next)) : [];
  const visibleStatus = closed ? t.closed : detail ? statusNames[detail.status][locale] : statusNames[status as FulfillmentStatus]?.[locale] ?? status;
  return <section className={styles.panel}><strong>{title} · {visibleStatus}</strong>
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void show(false)}>{t.read}</button><button type="button" disabled={!canWrite || busy || !published} onClick={() => void show(true)}>{t.reveal}</button>{detail && <button type="button" onClick={() => { setDetail(null); setVerified(false); }}>{t.hide}</button>}</div>
    {detail && <>
      {detail.recipientDeadlineAt && <p>{t.deadline}: {new Date(detail.recipientDeadlineAt).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul" })} (KST)</p>}
      {detail.recipient ? <dl><dt>{t.name}</dt><dd>{detail.recipient.name}</dd><dt>{t.phone}</dt><dd>{detail.recipient.phone}</dd>{detail.recipient.address1 && <><dt>{t.address}</dt><dd>{detail.recipient.postalCode} {detail.recipient.address1} {detail.recipient.address2}</dd></>}</dl> : <p>{t.notSubmitted}</p>}
      {canWrite && published && !closed && <fieldset disabled={busy}>
        <label>{t.memo}<textarea minLength={10} maxLength={1000} value={memo} onChange={e => setMemo(e.target.value)} /></label>
        {detail.method === "physical_shipping" && detail.status === "shipping_preparing" && <div className={styles.grid}><label>{t.carrier}<input value={carrier} onChange={e => setCarrier(e.target.value)} /></label><label>{t.tracking}<input value={tracking} onChange={e => setTracking(e.target.value)} /></label></div>}
        <div className={styles.actions}>{nextStatuses.filter(next => next !== "pickup_completed").map(next => <button type="button" key={next} onClick={() => void act(next)}>{statusNames[next][locale]} {t.process}</button>)}</div>
        {detail.method === "on_site_pickup" && detail.status === "pickup_available" && <><label className={styles.checkbox}><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />{t.verify}</label><div className={styles.actions}><button type="button" disabled={!verified} onClick={() => void act("pickup_completed")}>{t.complete}</button><button type="button" onClick={() => void act("pickup_completed", true)}>{t.review}</button></div></>}
        {canClose && <button type="button" className={styles.danger} onClick={() => void act(null, false, true)}>{t.close}</button>}
      </fieldset>}
    </>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
