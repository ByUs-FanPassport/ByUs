"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Check, MessageSquare, Plus, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { inquiryDetailSchema, inquiryListSchema, mutationSchema, type Inquiry, type SupportMessage } from "../domain/inquiry";
import { supportCopy } from "./copy";
import styles from "./inquiry.module.css";

type Locale = "ko" | "en";
type Props = { locale: Locale; id?: string; admin?: boolean; readonly?: boolean };
const parseList = (value: unknown) => inquiryListSchema.parse(value);
const parseDetail = (value: unknown) => inquiryDetailSchema.parse(value);
const poll = () => true;
const pageHref = (admin: boolean, locale: Locale, id?: string) => `${admin ? "/admin" : "/my"}/inquiries${id ? `/${id}` : ""}?${admin ? "lang" : "locale"}=${locale}` as Route;
const date = (value: string, locale: Locale) => new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul",
}).format(new Date(value));

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}
async function checked(response: Response) {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error((body as { error?: { code?: string } })?.error?.code ?? "CS_UNAVAILABLE");
  return body;
}
function errorText(error: unknown, locale: Locale) {
  const t = supportCopy[locale];
  const code = error instanceof Error ? error.message : "";
  if (code === "CS_RATE_LIMITED") return t.rateError;
  if (code === "CS_IDEMPOTENCY_CONFLICT") return t.conflictError;
  if (code === "CS_STALE_VERSION") return t.staleError;
  if (["CS_FORBIDDEN", "CS_NOT_FOUND", "AUTHENTICATION_REQUIRED"].includes(code)) return t.forbiddenError;
  return t.sendError;
}
function Status({ inquiry, locale }: { inquiry: Inquiry; locale: Locale }) {
  return <span className={styles.badge} data-status={inquiry.status}>{supportCopy[locale].status[inquiry.status]}</span>;
}

export function InquiryWorkspace(props: Props) {
  return props.id ? <Conversation {...props} id={props.id} /> : <InquiryList {...props} />;
}

function InquiryList({ locale, admin = false }: Props) {
  const auth = usePrivy(), router = useRouter(), mounted = useMounted();
  const t = supportCopy[locale];
  const [compose, setCompose] = useState(false);
  const [filter, setFilter] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1);
  const query = new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(filter ? { status: filter } : {}) });
  const api = `/api/${admin ? "admin" : "me"}/inquiries`;
  const resource = useOwnedFanResource(`${api}?${query}`, parseList, auth, poll);
  return <>
    <header className={styles.heading}><div><h1>{admin ? t.adminTitle : t.title}</h1><p>{admin ? t.adminIntro : t.intro}</p></div>
      {!admin && !compose && <FanAction variant="primary" onClick={() => setCompose(true)} leadingIcon={<Plus />}>{t.new}</FanAction>}
    </header>
    {compose && <section className={styles.compose} aria-labelledby="new-inquiry-title"><div className={styles.sectionHeading}><h2 id="new-inquiry-title">{t.new}</h2><FanAction variant="text" onClick={() => setCompose(false)}>{t.cancel}</FanAction></div>
      <MessageForm locale={locale} create onSubmit={async (input) => {
        const token = await auth.getAccessToken();
        if (!mounted.current) return false;
        if (!token) throw new Error("AUTHENTICATION_REQUIRED");
        const data = mutationSchema.parse(await checked(await fetch(api, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ...input, locale }) })));
        if (!mounted.current) return false;
        router.push(pageHref(false, locale, data.id));
        return true;
      }} />
    </section>}
    <div className={styles.toolbar}>
      {admin && <label className={styles.filter}>{t.statusFilter}<select value={filter} onChange={(event) => { setFilter(event.target.value); setCursors([null]); }}><option value="">{t.all}</option>{Object.entries(t.status).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <FanAction onClick={resource.retry} variant="text" leadingIcon={<RefreshCw />}>{t.refresh}</FanAction>
    </div>
    {resource.refreshFailed && <p className={styles.warning} role="status">{t.refreshError}</p>}
    {resource.state.status === "loading" ? <FanState kind="loading" title={t.loading} />
      : resource.state.status === "error" ? <FanState kind="error" title={t.error} actions={<FanAction onClick={resource.retry}>{t.retry}</FanAction>} />
        : <><ul className={styles.list} aria-label={admin ? t.adminTitle : t.title}>
          {resource.state.data.inquiries.map((inquiry) => <li key={inquiry.id}><Link href={pageHref(admin, locale, inquiry.id)} className={styles.inquiryRow}>
            <div className={styles.rowContent}><div className={styles.rowMeta}><Status inquiry={inquiry} locale={locale} />{admin && <span>{inquiry.requesterName}</span>}<time dateTime={inquiry.updatedAt}>{date(inquiry.updatedAt, locale)} KST</time></div><h2>{inquiry.subject}</h2></div><ArrowRight aria-hidden="true" />
          </Link></li>)}
        </ul>
          {!resource.state.data.inquiries.length && <div className={styles.empty}><MessageSquare aria-hidden="true" /><p>{admin ? t.adminEmpty : t.empty}</p></div>}
          <nav className={styles.pagination} aria-label={t.title}>
            {cursors.length > 1 && <FanAction onClick={() => setCursors((values) => values.slice(0, -1))}>{t.previous}</FanAction>}
            {resource.state.data.nextCursor && <FanAction onClick={() => { if (resource.state.status === "ready") { const next = resource.state.data.nextCursor; setCursors((values) => [...values, next]); } }}>{t.next}</FanAction>}
          </nav>
        </>}
  </>;
}

function Conversation({ locale, id, admin = false, readonly = false }: Props & { id: string }) {
  const auth = usePrivy(), mounted = useMounted();
  const t = supportCopy[locale], api = `/api/${admin ? "admin" : "me"}/inquiries/${id}`;
  const resource = useOwnedFanResource(api, parseDetail, auth, poll);
  const [older, setOlder] = useState<{ messages: SupportMessage[]; cursor: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false), [resolving, setResolving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const read = resource.state.status === "ready" ? resource.state.data : null;
  // A large batch of new replies can move the latest page past cached history.
  // Reset that disconnected history so its middle pages stay reachable.
  const hasGap = Boolean(older?.messages.length && read?.messages.length
    && !read.messages.some((message) => older.messages.some((previous) => previous.id === message.id)));
  const retained = hasGap ? null : older;
  const nextCursor = retained ? retained.cursor : read?.nextCursor;
  const messages = [...new Map([...(retained?.messages ?? []), ...(read?.messages ?? [])].map((message) => [message.id, message])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  async function request(path: string, body?: unknown) {
    const token = await auth.getAccessToken();
    if (!mounted.current) throw new Error("CS_UNMOUNTED");
    if (!token) throw new Error("AUTHENTICATION_REQUIRED");
    return checked(await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  }
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true); setError("");
    try {
      const page = parseDetail(await request(`${api}?cursor=${encodeURIComponent(nextCursor)}`));
      if (mounted.current) setOlder({ messages: [...page.messages, ...(retained?.messages ?? []), ...(read?.messages ?? [])], cursor: page.nextCursor });
    } catch (cause) { if (mounted.current) setError(errorText(cause, locale)); }
    finally { if (mounted.current) setLoadingOlder(false); }
  }
  async function resolve() {
    if (!read || resolving) return;
    setResolving(true); setError(""); setNotice("");
    try {
      await request(`${api}/resolve`, { expectedVersion: read.inquiry.version });
      if (mounted.current) { setNotice(t.resolvedNotice); resource.retry(); }
    } catch (cause) { if (mounted.current) { setError(errorText(cause, locale)); resource.retry(); } }
    finally { if (mounted.current) setResolving(false); }
  }
  return <>
    <div className={styles.back}><FanAction href={pageHref(admin, locale)} variant="text" leadingIcon={<ArrowLeft />}>{t.back}</FanAction></div>
    {resource.state.status === "loading" ? <FanState kind="loading" title={t.loading} />
      : resource.state.status === "error" ? <FanState kind="error" title={resource.state.kind === "missing" ? t.missing : t.error} actions={<FanAction onClick={resource.retry}>{t.retry}</FanAction>} />
        : read && <>
          <header className={styles.conversationHeading}><div className={styles.rowMeta}><Status inquiry={read.inquiry} locale={locale} />{admin && <span>{read.inquiry.requesterName}</span>}<time dateTime={read.inquiry.createdAt}>{date(read.inquiry.createdAt, locale)} KST</time></div><h1>{read.inquiry.subject}</h1></header>
          <div className={styles.toolbar}><FanAction variant="text" onClick={resource.retry} leadingIcon={<RefreshCw />}>{t.refresh}</FanAction>
            {admin && !readonly && read.inquiry.status !== "resolved" && <FanAction disabled={resolving} onClick={resolve} leadingIcon={<Check />}>{resolving ? t.resolving : t.resolve}</FanAction>}
          </div>
          {resource.refreshFailed && <p className={styles.warning} role="status">{t.refreshError}</p>}
          {nextCursor && <div className={styles.earlier}><FanAction onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? t.loading : t.earlier}</FanAction></div>}
          <ol className={styles.messages} aria-label={locale === "ko" ? "문의 대화" : "Conversation"}>
            {messages.map((message) => <li key={message.id} className={styles.message} data-own={message.sender === (admin ? "admin" : "fan")}>
              <div className={styles.messageMeta}><strong>{message.sender === "admin" ? t.team : admin ? read.inquiry.requesterName : t.me}</strong><time dateTime={message.createdAt}>{date(message.createdAt, locale)} KST</time></div><p>{message.body}</p>
            </li>)}
          </ol>
          {read.inquiry.status === "resolved" && <p className={styles.resolvedHelp}>{t.resolvedHelp}</p>}
          {readonly ? <p className={styles.resolvedHelp}>{t.readonly}</p> : <MessageForm locale={locale} onSubmit={async (input) => {
            mutationSchema.parse(await request(`${api}/messages`, input));
            if (!mounted.current) return false;
            // Preserve already displayed history before the newest page shifts forward.
            setOlder({ messages: [...(retained?.messages ?? []), ...read.messages], cursor: retained ? retained.cursor : read.nextCursor });
            resource.retry(); return true;
          }} />}
        </>}
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    <p role="status" className={styles.notice}>{notice}</p>
  </>;
}

function MessageForm({ locale, create = false, onSubmit }: {
  locale: Locale; create?: boolean; onSubmit: (input: { body: string; subject?: string; idempotencyKey: string }) => Promise<boolean>;
}) {
  const t = supportCopy[locale], mounted = useMounted();
  const [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState<"subject" | "body" | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const submitting = useRef(false);
  useEffect(() => { if (create) subjectRef.current?.focus(); }, [create]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(""); setNotice(""); setInvalid(null);
    if (create && (!subject.trim() || subject.trim().length > 120)) { setInvalid("subject"); setError(t.invalidSubject); subjectRef.current?.focus(); return; }
    if (!body.trim() || body.trim().length > 4000) { setInvalid("body"); setError(t.invalidBody); bodyRef.current?.focus(); return; }
    const input = { body: body.trim(), ...(create ? { subject: subject.trim() } : {}) };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    submitting.current = true; setBusy(true);
    try {
      const success = await onSubmit({ ...input, idempotencyKey: attempt.current.key });
      if (mounted.current && success) { setBody(""); setSubject(""); attempt.current = null; setNotice(t.sent); bodyRef.current?.focus(); }
    } catch (cause) { if (mounted.current) setError(errorText(cause, locale)); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <fieldset disabled={busy}>
      {create && <div className={styles.field}><label htmlFor="inquiry-subject">{t.subject}</label><input ref={subjectRef} id="inquiry-subject" name="subject" autoComplete="off" value={subject} maxLength={120} required aria-invalid={invalid === "subject"} aria-describedby={invalid === "subject" ? "inquiry-form-error" : "inquiry-subject-help"} onChange={(event) => setSubject(event.target.value)} /><p id="inquiry-subject-help">{t.subjectHelp}</p></div>}
      <div className={styles.field}><label htmlFor="inquiry-body">{create ? t.body : t.reply}</label><textarea ref={bodyRef} id="inquiry-body" name="message" autoComplete="off" rows={create ? 6 : 4} required maxLength={4000} value={body} aria-invalid={invalid === "body"} aria-describedby={invalid === "body" ? "inquiry-form-error" : create ? "inquiry-body-help" : undefined} onChange={(event) => setBody(event.target.value)} />{create && <p id="inquiry-body-help">{t.bodyHelp}</p>}</div>
    </fieldset>
    {error && <p role="alert" id="inquiry-form-error" className={styles.warning}>{error}</p>}
    <div className={styles.formActions}><p role="status" className={styles.notice}>{notice}</p><FanAction type="submit" variant="primary" disabled={busy} ariaBusy={busy} leadingIcon={<Send />}>{busy ? t.sending : create ? t.submit : t.send}</FanAction></div>
  </form>;
}
