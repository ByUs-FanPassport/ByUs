"use client";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { usePrivy } from "@privy-io/react-auth";
import { Ellipsis } from "lucide-react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { notifyFanActivityUpdated } from "@/components/fan-ui/fan-activity-updates";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import { rememberOverlayTrigger } from "@/components/ui/overlay/focus-return";
import { translationSchema, type TargetType } from "@/features/fan-posts/domain/content";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { shouldOfferTranslation } from "../domain/translation-eligibility";
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
  const [reason, setReason] = useState(""), [message, setMessage] = useState(""), [reportOpen, setReportOpen] = useState(false);
  const attempt = useRef<{ reason: string; key: string } | null>(null), trigger = useRef<HTMLButtonElement | null>(null), reasonField = useRef<HTMLTextAreaElement | null>(null);
  if (!auth.ready || !auth.authenticated) return null;
  async function report() {
    const text = reason.trim();
    if (!text) return;
    if (attempt.current?.reason !== text) attempt.current = { reason: text, key: crypto.randomUUID() };
    const result = await mutation.request("/api/content-reports", "POST", { targetType, targetId, reason: text, idempotencyKey: attempt.current.key });
    if (result) { setReason(""); setReportOpen(false); setMessage(copy.reportSent); attempt.current = null; }
  }
  async function block() {
    if (!window.confirm(copy.blockConfirm)) return;
    if (await mutation.request("/api/content-blocks", "POST", { targetType, targetId })) {
      setMessage(copy.blocked); notifyFanActivityUpdated(auth.user?.id); onChanged?.();
    }
  }
  return <div className={styles.contentActions}>
    <Menu.Root>
      <Menu.Trigger ref={trigger} className={styles.moreTrigger} aria-label={copy.more}><Ellipsis size={20} aria-hidden="true" /></Menu.Trigger>
      <Menu.Portal><Menu.Positioner className={styles.menuPositioner} sideOffset={4} align="end"><Menu.Popup className={styles.menuPopup}>
        <Menu.Item className={styles.menuItem} onClick={() => { if (trigger.current) rememberOverlayTrigger(trigger.current); setReportOpen(true); }}>{copy.report}</Menu.Item>
        {canBlock && <Menu.Item className={styles.menuItem} disabled={mutation.busy} onClick={() => void block()}>{copy.block}</Menu.Item>}
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
    {reportOpen && <AccessibleOverlay open onClose={() => setReportOpen(false)} labelledBy={`${fieldId}-title`} initialFocusRef={reasonField} busy={mutation.busy} backdropClassName={styles.reportBackdrop} contentClassName={styles.reportDialog} contentAs="section">
      <h2 id={`${fieldId}-title`}>{copy.report}</h2>
      <form onSubmit={event => { event.preventDefault(); void report(); }}>
        <label className={styles.field} htmlFor={fieldId}>{copy.reportReason}<textarea ref={reasonField} id={fieldId} required maxLength={500} rows={3} value={reason} disabled={mutation.busy} onChange={event => setReason(event.target.value)} /></label>
        <div className={styles.actions}><FanAction type="button" disabled={mutation.busy} onClick={() => setReportOpen(false)}>{copy.cancel}</FanAction><FanAction type="submit" disabled={mutation.busy || !reason.trim()}>{copy.report}</FanAction></div>
      </form>
    </AccessibleOverlay>}
    {message && <span role="status" className={styles.status}>{message}</span>}{mutation.error && <span role="alert" className={styles.error}>{mutation.error}</span>}
  </div>;
}

export function ContentTranslation({ targetType, targetId, locale, children, sourceText, sourceRevision = 1 }: {
  targetType: TargetType; targetId: string; locale: AppLocale; children: ReactNode; sourceText: string; sourceRevision?: number;
}) {
  const auth = usePrivy(), session = useByUsSession(), copy = contentCopy(locale), mutation = useContentMutation(locale);
  const key = `${targetType}:${targetId}:${sourceRevision}:${sourceText}:${locale}:${session.ownerId ?? auth.user?.id}:${session.generation}:${auth.authenticated}`;
  const [translated, setTranslated] = useState<{ key: string; text: string } | null>(null);
  const showing = translated?.key === key;
  const eligible = useMemo(() => shouldOfferTranslation(sourceText, locale), [sourceText, locale]);
  async function toggle() {
    if (showing) { setTranslated(null); return; }
    const raw = await mutation.request("/api/content-translations", "POST", { targetType, targetId, targetLocale: locale, locale: toContentLocale(locale) });
    const parsed = translationSchema.safeParse(raw);
    if (parsed.success) setTranslated({ key, text: parsed.data.translatedText });
  }
  return <div className={styles.translation}>
    {showing ? <p className={styles.body} lang={locale}>{translated.text}</p> : children}
    {auth.ready && auth.authenticated && eligible && <button type="button" className={styles.translationButton} disabled={mutation.busy} onClick={() => void toggle()} aria-pressed={showing}>
      {mutation.busy ? copy.translating : showing ? copy.original : copy.translate}</button>}
    {mutation.error && <span role="alert" className={styles.error}>{mutation.error}</span>}
  </div>;
}
