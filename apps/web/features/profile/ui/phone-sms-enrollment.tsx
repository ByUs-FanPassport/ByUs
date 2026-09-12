"use client";
import { useEffect, useRef, useState } from "react";
import type { NotificationChannel } from "../../notification/domain/connected-account";
import styles from "./phone-sms-enrollment.module.css";

type Challenge = { challengeId: string; destinationLabel: string; expiresAt: string; resendAt: string; status: string };
type Props = { locale: "ko" | "en"; disabled?: boolean; getAccessToken(): Promise<string | null>;
  acquire(): boolean; release(): void; onRegistered(channel: NotificationChannel): void };
const copy = {
  ko: { title: "휴대폰 번호로 알림톡 받기", help: "카카오톡을 사용하는 국내 휴대폰 번호를 등록해 주세요.", phone: "휴대폰 번호", format: "010으로 시작하는 번호를 입력해 주세요.", request: "인증번호 받기", code: "문자로 받은 인증번호", verify: "인증번호 확인", resend: "다시 받기", consent: "LIVE 예약·시작 등 서비스 알림을 이 번호로 받는 데 동의합니다.", confirm: "이 번호로 알림톡 등록", change: "번호 변경", busy: "처리 중…", verified: "휴대폰 번호를 확인했어요.", success: "알림톡 수신 번호를 등록했어요.", expired: "인증 시간이 지났어요. 인증번호를 다시 받아 주세요.", unknown: "문자 접수 결과를 확인하지 못했어요. 문자가 도착했다면 인증번호를 입력해 주세요.", rejected: "인증 문자를 보내지 못했어요. 잠시 후 다시 받아 주세요.", invalid: "휴대폰 번호 또는 인증번호를 확인해 주세요.", wrong: "인증번호가 일치하지 않아요. 다시 확인해 주세요.", limit: "인증 요청이 많아요. 잠시 후 다시 시도해 주세요.", exhausted: "입력 횟수를 초과했어요. 인증번호를 다시 받아 주세요.", failed: "요청을 완료하지 못했어요. 다시 시도해 주세요.", remaining: "남은 시간", retryIn: "초 후 다시 받기", replaced: "등록하면 기존 알림톡 수신 번호가 변경됩니다." },
  en: { title: "Get Alimtalk at your phone number", help: "Register a Korean mobile number used for KakaoTalk.", phone: "Mobile number", format: "Enter a Korean mobile number starting with 010.", request: "Send verification code", code: "Code received by SMS", verify: "Verify code", resend: "Send again", consent: "I agree to receive service notifications, including LIVE reservations and reminders, at this number.", confirm: "Register for Alimtalk", change: "Change number", busy: "Processing…", verified: "Your phone number is verified.", success: "Your Alimtalk number is registered.", expired: "The code expired. Request a new code.", unknown: "We could not confirm the SMS submission. If the message arrived, enter its code.", rejected: "The SMS could not be sent. Please try again shortly.", invalid: "Check the mobile number or verification code.", wrong: "The code does not match. Please check it and try again.", limit: "Too many requests. Please try again later.", exhausted: "Too many incorrect codes. Request a new code.", failed: "Could not complete the request. Please try again.", remaining: "Time remaining", retryIn: "s until you can resend", replaced: "Registration replaces your existing Alimtalk number." },
};
export function PhoneSmsEnrollment({ locale, disabled, getAccessToken, acquire, release, onRegistered }: Props) {
  const t = copy[locale];
  const [phone, setPhone] = useState(""); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [verified, setVerified] = useState(false); const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [done, setDone] = useState(false);
  const [now, setNow] = useState(0); const [exhausted, setExhausted] = useState(false);
  const active = useRef(true); const pending = useRef(false); const requestId = useRef<string | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (!challenge) return; const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [challenge]);
  const remaining = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1000)) : 0;
  const resendWait = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now) / 1000)) : 0;
  const locked = busy || Boolean(disabled);
  function errorText(error: unknown) {
    const value = error instanceof Error ? error.message : "";
    if (/EXHAUSTED/.test(value)) { setExhausted(true); return t.exhausted; }
    if (/RATE|LIMIT|COOLDOWN/.test(value)) return t.limit;
    if (/EXPIRED/.test(value)) return t.expired;
    if (/INVALID_CODE|WRONG_CODE|CODE_MISMATCH/.test(value)) return t.wrong;
    if (/INVALID_PHONE|INVALID_REQUEST|CODE_INVALID/.test(value)) return t.invalid;
    return t.failed;
  }
  async function api(action: string, body: unknown) {
    const token = await getAccessToken(); if (!token) throw new Error("UNAUTHENTICATED");
    const response = await fetch(`/api/me/notification-channels/kakao/phone/${action}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(result.error?.code ?? "FAILED");
    return result;
  }
  async function run(action: "request" | "resend" | "verify" | "confirm" | "cancel") {
    if (pending.current || disabled || !acquire()) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      if (action === "request" || action === "resend") {
        if (action === "resend") requestId.current = null;
        requestId.current ??= crypto.randomUUID();
        const result = await api("request", { phone, requestId: requestId.current });
        if (!active.current) return;
        setChallenge(result.challenge); setNow(Date.now()); setCode(""); setVerified(false); setConsented(false); setExhausted(false);
        if (result.challenge.status === "unknown" || result.challenge.status === "sending") setMessage(t.unknown);
        if (result.challenge.status === "rejected") setMessage(t.rejected);
      } else if (action === "verify" && challenge) {
        await api("verify", { challengeId: challenge.challengeId, code });
        if (!active.current) return;
        setVerified(true); setCode(""); setMessage(t.verified);
      } else if (action === "confirm" && challenge && verified && consented) {
        const result = await api("confirm", { challengeId: challenge.challengeId, consented: true, consentVersion: "kakao-alimtalk-v1" });
        if (!active.current) return;
        onRegistered(result.channel); setDone(true); setPhone(""); setCode(""); setChallenge(null); setConsented(false); setMessage(t.success);
      } else if (action === "cancel") {
        if (challenge) await api("cancel", { challengeId: challenge.challengeId });
        if (!active.current) return;
        setChallenge(null); setCode(""); setVerified(false); setConsented(false); requestId.current = null;
      }
    } catch (error) { if (active.current) setMessage(errorText(error)); }
    finally { pending.current = false; release(); if (active.current) setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="phone-sms-title">
    <h4 id="phone-sms-title">{t.title}</h4><p>{t.help}</p>
    {done ? <button type="button" disabled={locked} onClick={() => { setDone(false); setVerified(false); requestId.current = null; setMessage(""); }}>{t.change}</button> : <>
      {!challenge ? <>
        <label htmlFor="phone-sms-number">{t.phone}</label>
        <input id="phone-sms-number" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={32} value={phone} disabled={locked} aria-describedby="phone-sms-format" onChange={(event) => { setPhone(event.target.value); requestId.current = null; }} />
        <small id="phone-sms-format">{t.format}</small>
        <button type="button" disabled={locked || !/^(?:010\d{8}|\+8210\d{8}|\+82010\d{8})$/.test(phone.replace(/[ -]/g, ""))} onClick={() => void run("request")}>{busy ? t.busy : t.request}</button>
      </> : <>
        <strong>{challenge.destinationLabel}</strong>
        {remaining === 0 ? <p role="status">{t.expired}</p> : <small>{t.remaining} {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</small>}
        {!verified && <>
          <label htmlFor="phone-sms-code">{t.code}</label>
          <input id="phone-sms-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={locked || exhausted || remaining === 0} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
          <button type="button" disabled={locked || exhausted || remaining === 0 || !/^\d{6}$/.test(code)} onClick={() => void run("verify")}>{busy ? t.busy : t.verify}</button>
        </>}
        {verified && <>
          <label className={styles.consent}><input type="checkbox" checked={consented} disabled={locked || remaining === 0} onChange={(event) => setConsented(event.target.checked)} /><span>{t.consent}</span></label>
          <small>{t.replaced}</small>
          <button type="button" disabled={locked || !consented || remaining === 0} onClick={() => void run("confirm")}>{busy ? t.busy : t.confirm}</button>
        </>}
        <div className={styles.actions}><button type="button" disabled={locked || resendWait > 0} onClick={() => void run("resend")}>{resendWait > 0 ? `${resendWait}${t.retryIn}` : t.resend}</button><button type="button" disabled={locked} onClick={() => void run("cancel")}>{t.change}</button></div>
      </>}
    </>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}
