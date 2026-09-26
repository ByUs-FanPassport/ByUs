"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanHeading } from "@/components/fan-ui/fan-heading";
import { FanAppFrame } from "@/components/fan-shell/fan-app-shell";
import { withRequestDeadline } from "@/features/reliability/client/request-deadline";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import type { AppLocale } from "@/i18n/locales";
import { localScheduleTime, scheduleInstant } from "../domain/schedule-time";
import type { ScheduleInput } from "../domain/participation";
import styles from "./participation.module.css";

export function useParticipationAction() {
  const auth = usePrivy();
  const session = useByUsSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  useEffect(() => { setBusy(false); setError(""); const ownedKeys = keys.current; return () => { controller.current?.abort(); controller.current = null; ownedKeys.clear(); }; }, [auth.user?.id, auth.authenticated, session.generation]);
  const idempotencyKey = (input: unknown) => {
    const fingerprint = JSON.stringify(input);
    const previous = keys.current.get(fingerprint);
    if (previous) return previous;
    const key = crypto.randomUUID(); keys.current.set(fingerprint, key); return key;
  };
  async function run<T>(url: string, method: string, body: unknown, parse: (value: unknown) => T, requireAuth = true): Promise<T | null> {
    if (controller.current) return null;
    const active = new AbortController(); controller.current = active; setBusy(true); setError("");
    try {
      return await withRequestDeadline(async signal => {
        const token = auth.authenticated ? await auth.getAccessToken() : null;
        signal.throwIfAborted();
        if (requireAuth && (!token || !session.ready)) throw new Error("AUTHENTICATION_REQUIRED");
        const response = await fetch(url, { method, signal, cache: "no-store", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === null ? {} : { "content-type": "application/json" }) }, body: body === null ? undefined : JSON.stringify(body) });
        const result: unknown = await response.json(); signal.throwIfAborted();
        if (!response.ok) {
          const code = (result as { error?: { code?: unknown } })?.error?.code;
          throw new Error(typeof code === "string" ? code : "UNAVAILABLE");
        }
        return parse(result);
      }, { signal: active.signal });
    } catch (reason) {
      if (!active.signal.aborted) setError(reason instanceof Error ? reason.message : "UNAVAILABLE");
      return null;
    } finally { if (controller.current === active) { controller.current = null; setBusy(false); } }
  }
  return { ...auth, ready: auth.ready && session.ready, busy, error, setError, run, idempotencyKey };
}
export function ActionFeedback({ locale, error, saved }: { locale: AppLocale; error?: string; saved?: boolean }) {
  const c = participationCopy(locale);
  const message = error?.includes("CONFLICT") ? c.conflict : error?.includes("CLOSED") ? c.closed : error?.includes("MEMBERS_REQUIRED") ? c.members : error?.includes("AUTHENTICATION") ? c.login : c.error;
  return error ? <p role="alert" className={styles.feedback}>{message}</p> : saved ? <p role="status" className={styles.feedback}>{c.saved}</p> : null;
}
export function ParticipationPage({ locale, title, path, backAction, children }: { locale: AppLocale; title: string; path: string; backAction?: ReactNode; children: ReactNode }) {
  return <FanAppFrame locale={locale} currentPath={path} mainId="participation-main"><main className={styles.page} id="participation-main" tabIndex={-1}>{backAction && <div className={styles.backAction}>{backAction}</div>}<FanHeading as="h1" variant="personal-page">{title}</FanHeading>{children}</main></FanAppFrame>;
}
export function ParticipationState({ locale, status, retry }: { locale: AppLocale; status: "loading" | "error"; retry?: () => void }) {
  const c = participationCopy(locale);
  return <div role={status === "error" ? "alert" : "status"} className={styles.feedback}><p>{status === "error" ? c.error : c.loading}</p>{status === "error" && retry && <FanAction onClick={retry}>{c.retry}</FanAction>}</div>;
}
export type ScheduleFieldErrors = Partial<Record<"startsAt" | "endsAt" | "timeZone" | "sourceUrl", string>>;
export function ScheduleFields({ locale, initial, errors = {} }: { locale: AppLocale; initial?: Partial<ScheduleInput>; errors?: ScheduleFieldErrors }) {
  const c = participationCopy(locale), zone = initial?.timeZone ?? "Asia/Seoul";
  const error = (name: keyof ScheduleFieldErrors) => ({ "aria-invalid": Boolean(errors[name]) || undefined, "aria-describedby": errors[name] ? `schedule-${name}-error` : undefined });
  return <>
    <label>{c.event}<select name="kind" defaultValue={initial?.kind ?? "event"}>{(["broadcast", "concert", "birthday", "event"] as const).map(kind => <option value={kind} key={kind}>{c[kind]}</option>)}</select></label>
    <label>{c.title}<input name="title" required maxLength={160} defaultValue={initial?.title} /></label>
    <label>{c.description}<textarea name="description" rows={3} maxLength={4000} defaultValue={initial?.description} /></label>
    <div className={styles.columns}><label>{c.start}<input name="startsAt" required type="datetime-local" defaultValue={initial?.startsAt ? localScheduleTime(initial.startsAt, zone) : ""} {...error("startsAt")} />{errors.startsAt && <span id="schedule-startsAt-error" className={styles.meta}>{errors.startsAt}</span>}</label><label>{c.end}<input name="endsAt" required type="datetime-local" defaultValue={initial?.endsAt ? localScheduleTime(initial.endsAt, zone) : ""} {...error("endsAt")} />{errors.endsAt && <span id="schedule-endsAt-error" className={styles.meta}>{errors.endsAt}</span>}</label></div>
    <label>{c.timezone}<input name="timeZone" required maxLength={100} defaultValue={zone} {...error("timeZone")} />{errors.timeZone && <span id="schedule-timeZone-error" className={styles.meta}>{errors.timeZone}</span>}</label>
    <label>{c.location}<input name="location" maxLength={300} defaultValue={initial?.location} /></label>
    <label>{c.instructions}<textarea name="participationInstructions" rows={2} maxLength={2000} defaultValue={initial?.participationInstructions} /></label>
    <label>{c.source}<input name="sourceUrl" required type="url" maxLength={2048} defaultValue={initial?.sourceUrl} {...error("sourceUrl")} />{errors.sourceUrl && <span id="schedule-sourceUrl-error" className={styles.meta}>{errors.sourceUrl}</span>}</label>
  </>;
}
export function scheduleFieldErrors(form: HTMLFormElement, locale: AppLocale): ScheduleFieldErrors {
  const c = participationCopy(locale), data = new FormData(form), errors: ScheduleFieldErrors = {};
  const timeZone = String(data.get("timeZone") ?? ""), startsAt = String(data.get("startsAt") ?? ""), endsAt = String(data.get("endsAt") ?? "");
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { errors.timeZone = c.invalidTimeZone; }
  let start: string | undefined, end: string | undefined;
  if (!errors.timeZone) {
    try { start = scheduleInstant(startsAt, timeZone); } catch { errors.startsAt = c.invalidLocalTime; }
    try { end = scheduleInstant(endsAt, timeZone); } catch { errors.endsAt = c.invalidLocalTime; }
  }
  if (start && end && Date.parse(start) >= Date.parse(end)) errors.endsAt = c.endAfterStart;
  try { if (new URL(String(data.get("sourceUrl") ?? "")).protocol !== "https:") errors.sourceUrl = c.httpsRequired; } catch { errors.sourceUrl = c.httpsRequired; }
  return errors;
}
export function scheduleFormValues(form: HTMLFormElement) {
  const values = Object.fromEntries(new FormData(form));
  const timeZone = String(values.timeZone);
  return { kind: String(values.kind), title: String(values.title), description: String(values.description ?? ""), timeZone,
    startsAt: scheduleInstant(String(values.startsAt), timeZone), endsAt: scheduleInstant(String(values.endsAt), timeZone),
    location: String(values.location ?? ""), participationInstructions: String(values.participationInstructions ?? ""), sourceUrl: String(values.sourceUrl) };
}

/** Reschedules long deadlines and updates controls at the actual boundary. */
export function useDeadlinePassed(instant: string | null | undefined): boolean {
  const [snapshot, setSnapshot] = useState<{ instant: string; passed: boolean } | null>(null);
  useEffect(() => {
    if (!instant) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const remaining = Date.parse(instant) - Date.now();
      setSnapshot({ instant, passed: !(remaining > 0) });
      if (remaining > 0) timer = setTimeout(check, Math.min(2_147_483_647, remaining));
    };
    check(); return () => clearTimeout(timer);
  }, [instant]);
  return !instant || snapshot?.instant !== instant || snapshot.passed;
}
