"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import styles from "./inquiry-dialog.module.css";

type Draft = { name: string; company: string; email: string; message: string; consent: boolean };
type SubmitState = "idle" | "pending" | "success" | "error";
type Attempt = { fingerprint: string; key: string };

const emptyDraft: Draft = { name: "", company: "", email: "", message: "", consent: false };
const copy = {
  ko: {
    title: "미국 팬미팅 프로젝트 문의",
    description: "현재 정해진 내용만 알려주세요. 담당자가 확인 후 회신드릴게요.",
    name: "담당자명", company: "회사명", email: "회신 이메일", message: "문의 내용",
    namePlaceholder: "홍길동", companyPlaceholder: "회사명을 입력해 주세요", emailPlaceholder: "name@company.com",
    messagePlaceholder: "출연자, 희망 도시와 시기, 필요한 지원을 알려주세요.",
    consent: "문의 응대와 회신을 위해 입력한 개인정보를 이용하는 데 동의합니다.",
    submit: "문의 접수하기", pending: "접수 중", close: "문의창 닫기",
    successTitle: "문의가 접수됐어요",
    successBody: "담당자가 내용을 확인한 뒤 입력하신 이메일로 회신드릴게요.",
    done: "확인",
    errors: {
      INQUIRY_INVALID: "입력한 내용을 다시 확인해 주세요.",
      INQUIRY_RATE_LIMITED: "잠시 후 다시 시도해 주세요.",
      INQUIRY_IDEMPOTENCY_CONFLICT: "내용이 변경되었어요. 다시 접수해 주세요.",
      INQUIRY_UNAVAILABLE: "지금은 문의를 접수할 수 없어요. 입력 내용은 그대로 보관했어요.",
      TIMEOUT: "응답이 지연되고 있어요. 같은 내용으로 다시 시도해 주세요.",
    },
  },
  en: {
    title: "Tell us about your U.S. fan meeting",
    description: "Share what you know so far. Our team will review it and reply by email.",
    name: "Contact name", company: "Company", email: "Reply email", message: "Project details",
    namePlaceholder: "Your name", companyPlaceholder: "Company name", emailPlaceholder: "name@company.com",
    messagePlaceholder: "Tell us about the talent, preferred city and timing, and the support you need.",
    consent: "I agree that the information I provide may be used to respond to this inquiry.",
    submit: "Send inquiry", pending: "Sending", close: "Close inquiry dialog",
    successTitle: "Your inquiry has been received",
    successBody: "Our team will review your message and reply to the email address you provided.",
    done: "Done",
    errors: {
      INQUIRY_INVALID: "Please review the information you entered.",
      INQUIRY_RATE_LIMITED: "Please wait a moment and try again.",
      INQUIRY_IDEMPOTENCY_CONFLICT: "Your message changed. Please submit it again.",
      INQUIRY_UNAVAILABLE: "We can’t receive inquiries right now. Your message has been kept here.",
      TIMEOUT: "The response is taking longer than expected. Please retry with the same details.",
    },
  },
} as const;

const InquiryContext = createContext<{ open: () => void } | null>(null);

function canonicalPayload(locale: FanLocale, draft: Draft) {
  return { locale, name: draft.name.trim(), company: draft.company.trim(), email: draft.email.trim(), message: draft.message.trim(), consent: draft.consent };
}

function errorCode(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return null;
  return error.code;
}

export function FanmeetingInquiryProvider({ locale, children }: { locale: FanLocale; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const successButtonRef = useRef<HTMLButtonElement>(null);
  const t = copy[locale];

  useEffect(() => {
    if (submitState === "success") successButtonRef.current?.focus();
  }, [submitState]);

  const show = useCallback(() => {
    setError(null);
    setSubmitState((current) => current === "success" ? "idle" : current);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    if (submitState === "pending") return;
    setIsOpen(false);
    if (submitState === "success") setSubmitState("idle");
  }, [submitState]);
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setSubmitState("idle");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === "pending") return;
    const payload = canonicalPayload(locale, draft);
    const fingerprint = JSON.stringify(payload);
    const attempt = attemptRef.current?.fingerprint === fingerprint
      ? attemptRef.current
      : { fingerprint, key: window.crypto.randomUUID() };
    attemptRef.current = attempt;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setError(null);
    setSubmitState("pending");
    try {
      const response = await fetch("/api/inquiries/fanmeeting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: attempt.key, ...payload }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if ((response.status === 200 || response.status === 202) && body && typeof body === "object" && "status" in body && body.status === "accepted") {
        setSubmitState("success");
        setDraft(emptyDraft);
        attemptRef.current = null;
        return;
      }
      const code = errorCode(body);
      const knownCode = code && code in t.errors ? code as keyof typeof t.errors : "INQUIRY_UNAVAILABLE";
      setError(t.errors[knownCode]);
      setSubmitState("error");
      if (knownCode === "INQUIRY_IDEMPOTENCY_CONFLICT") attemptRef.current = null;
    } catch (caught) {
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      setError(timedOut ? t.errors.TIMEOUT : t.errors.INQUIRY_UNAVAILABLE);
      setSubmitState("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const busy = submitState === "pending";
  return (
    <InquiryContext.Provider value={{ open: show }}>
      {children}
      <AccessibleOverlay open={isOpen} onClose={close} labelledBy="fanmeeting-inquiry-title" describedBy={submitState === "success" ? "fanmeeting-inquiry-success-body" : "fanmeeting-inquiry-description"} initialFocusRef={firstFieldRef} backdropClassName={styles.backdrop} contentClassName={styles.dialog} contentAs="section" busy={busy}>
        <button className={styles.close} type="button" onClick={close} disabled={busy} aria-label={t.close}><X aria-hidden="true" size={22} /></button>
        {submitState === "success" ? (
          <div className={styles.success}>
            <CheckCircle2 aria-hidden="true" />
            <h2 id="fanmeeting-inquiry-title">{t.successTitle}</h2>
            <p id="fanmeeting-inquiry-success-body">{t.successBody}</p>
            <button ref={successButtonRef} className={styles.submit} type="button" onClick={close}>{t.done}</button>
          </div>
        ) : (
          <>
            <header className={styles.heading}>
              <p className={styles.eyebrow}>U.S. FAN MEETINGS</p>
              <h2 id="fanmeeting-inquiry-title">{t.title}</h2>
              <p id="fanmeeting-inquiry-description">{t.description}</p>
            </header>
            <form className={styles.form} onSubmit={submit} aria-describedby={error ? "fanmeeting-inquiry-error" : undefined}>
              <div className={styles.twoColumns}>
                <label>{t.name}<input ref={firstFieldRef} name="name" value={draft.name} onChange={(event) => update("name", event.target.value)} maxLength={80} required disabled={busy} placeholder={t.namePlaceholder} /></label>
                <label>{t.company}<input name="company" value={draft.company} onChange={(event) => update("company", event.target.value)} maxLength={120} required disabled={busy} placeholder={t.companyPlaceholder} /></label>
              </div>
              <label>{t.email}<input name="email" type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} maxLength={254} required disabled={busy} placeholder={t.emailPlaceholder} /></label>
              <label>{t.message}<textarea name="message" value={draft.message} onChange={(event) => update("message", event.target.value)} maxLength={4000} required disabled={busy} placeholder={t.messagePlaceholder} /></label>
              <label className={styles.consent}><input name="consent" type="checkbox" checked={draft.consent} onChange={(event) => update("consent", event.target.checked)} required disabled={busy} /><span>{t.consent}</span></label>
              {error ? <p className={styles.error} id="fanmeeting-inquiry-error" role="alert">{error}</p> : null}
              <button className={styles.submit} type="submit" disabled={busy}>
                {busy ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : null}{busy ? t.pending : t.submit}{!busy ? <ArrowUpRight aria-hidden="true" size={18} /> : null}
              </button>
            </form>
          </>
        )}
      </AccessibleOverlay>
    </InquiryContext.Provider>
  );
}

export function InquiryButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const context = useContext(InquiryContext);
  if (!context) throw new Error("InquiryButton must be used inside FanmeetingInquiryProvider");
  return <button className={className} type="button" onClick={context.open}>{children}<ArrowUpRight aria-hidden="true" size={18} /></button>;
}
