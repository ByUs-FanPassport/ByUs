"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { notifyFanActivityUpdated } from "@/components/fan-ui/fan-activity-updates";
import { translationSchema, type TargetType } from "@/features/fan-posts/domain/content";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { useContentMutation } from "./use-content-mutation";
import { useByUsSession } from "@/components/byus-session-provider";
import styles from "./content.module.css";

type ContentActionsProps = {
  targetType: TargetType; targetId: string; locale: AppLocale; onChanged?: () => void; canBlock?: boolean;
};
export function ContentActions(props: ContentActionsProps) {
  const auth = usePrivy(), session = useByUsSession();
  return <ActionsForOwner key={`${props.targetType}:${props.targetId}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}`} {...props} />;
}
function ActionsForOwner({ targetType, targetId, locale, onChanged, canBlock = true }: ContentActionsProps) {
  const auth = usePrivy(), copy = contentCopy(locale), mutation = useContentMutation(locale), fieldId = useId();
  const [reason, setReason] = useState(""), [message, setMessage] = useState("");
  const attempt = useRef<{ reason: string; key: string } | null>(null), summary = useRef<HTMLElement | null>(null), details = useRef<HTMLDetailsElement | null>(null);
  if (!auth.ready || !auth.authenticated) return null;
  async function report() {
    const text = reason.trim();
    if (!text) return;
    if (attempt.current?.reason !== text) attempt.current = { reason: text, key: crypto.randomUUID() };
    const result = await mutation.request("/api/content-reports", "POST", { targetType, targetId, reason: text, idempotencyKey: attempt.current.key });
    if (result) { setReason(""); if (details.current) details.current.open = false; setMessage(copy.reportSent); attempt.current = null; summary.current?.focus(); }
  }
  async function block() {
    if (!window.confirm(copy.blockConfirm)) return;
    if (await mutation.request("/api/content-blocks", "POST", { targetType, targetId })) {
      setMessage(copy.blocked); if (details.current) details.current.open = false; notifyFanActivityUpdated(auth.user?.id); onChanged?.();
    }
  }
  return <div className={styles.actions}>
    <details ref={details} className={styles.details}>
      <summary ref={summary}>{copy.report}</summary>
      <form onSubmit={event => { event.preventDefault(); void report(); }}>
        <label className={styles.field} htmlFor={fieldId}>{copy.reportReason}<textarea id={fieldId} required maxLength={500} rows={2} value={reason} disabled={mutation.busy} onChange={event => setReason(event.target.value)} /></label>
        <div className={styles.actions}><FanAction type="submit" disabled={mutation.busy || !reason.trim()}>{copy.report}</FanAction></div>
      </form>
    </details>
    {canBlock && <button type="button" disabled={mutation.busy} onClick={() => void block()}>{copy.block}</button>}
    {message && <span role="status" className={styles.status}>{message}</span>}{mutation.error && <span role="alert" className={styles.error}>{mutation.error}</span>}
  </div>;
}

export function ContentTranslation({ targetType, targetId, locale, children, sourceRevision = 1 }: {
  targetType: TargetType; targetId: string; locale: AppLocale; children: ReactNode; sourceRevision?: number;
}) {
  const auth = usePrivy(), session = useByUsSession(), copy = contentCopy(locale), mutation = useContentMutation(locale);
  const key = `${targetType}:${targetId}:${sourceRevision}:${locale}:${session.ownerId ?? auth.user?.id}:${session.generation}:${auth.authenticated}`;
  const [translated, setTranslated] = useState<{ key: string; text: string } | null>(null);
  const showing = translated?.key === key;
  async function toggle() {
    if (showing) { setTranslated(null); return; }
    const raw = await mutation.request("/api/content-translations", "POST", { targetType, targetId, targetLocale: locale, locale: toContentLocale(locale) });
    const parsed = translationSchema.safeParse(raw);
    if (parsed.success) setTranslated({ key, text: parsed.data.translatedText });
  }
  return <div className={styles.translation}>
    {showing ? <p className={styles.body} lang={locale}>{translated.text}</p> : children}
    {auth.ready && auth.authenticated && <button type="button" className={styles.button} disabled={mutation.busy} onClick={() => void toggle()} aria-pressed={showing}>
      {mutation.busy ? copy.translating : showing ? copy.original : copy.translate}</button>}
    {mutation.error && <span role="alert" className={styles.error}>{mutation.error}</span>}
  </div>;
}
