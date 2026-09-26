"use client";
import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { ArrowLeft, CalendarDays, FileText } from "lucide-react";
import { personalCopy } from "@/i18n/catalogs/features__my__ui__personal-copy";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { pageSchema, suggestionSchema, fanpageRequestSchema, type ScheduleSuggestion, type FanpageRequest } from "../domain/participation";
import { ParticipationPage, ParticipationState } from "./participation-ui";
import styles from "./participation.module.css";
const parseSuggestions = (value: unknown) => pageSchema(suggestionSchema).parse(value);
const parseRequests = (value: unknown) => pageSchema(fanpageRequestSchema).parse(value);
type RequestPage = { items: (ScheduleSuggestion | FanpageRequest)[]; nextCursor: string | null };

export function ParticipationRequests({ locale, initialTab = "schedules", highlightId }: { locale: AppLocale; initialTab?: "schedules" | "fanpages"; highlightId?: string }) {
  const [tab, setTab] = useState(initialTab), auth = usePrivy(), c = participationCopy(locale);
  return <ParticipationPage locale={locale} title={c.requests} path="/my/requests" backAction={<FanAction variant="text" href={`/my?locale=${locale}`} leadingIcon={<ArrowLeft />}>{personalCopy[locale].back}</FanAction>}>
    <section className={styles.panel} aria-label={c.requests}><div className={styles.tabs} role="group" aria-label={c.requests}>{(["schedules", "fanpages"] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "schedules" ? c.suggest : c.fanpage}</button>)}</div>
    <History key={`${tab}:${locale}:${auth.user?.id ?? "guest"}`} tab={tab} locale={locale} highlightId={highlightId} /></section>
  </ParticipationPage>;
}
function History({ locale, tab, highlightId }: { locale: AppLocale; tab: "schedules" | "fanpages"; highlightId?: string }) {
  const auth = usePrivy(), c = participationCopy(locale), [cursor, setCursor] = useState<string | null>(null);
  const url = auth.ready && auth.authenticated ? `/api/${tab === "schedules" ? "schedule-suggestions" : "fanpage-requests"}?locale=${toContentLocale(locale)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` : null;
  const resource = useFanpageResource<RequestPage>(url, tab === "schedules" ? parseSuggestions : parseRequests);
  if (!auth.ready) return <ParticipationState status="loading" locale={locale} />;
  if (!auth.authenticated) return <FanAction onClick={() => auth.login()}>{c.login}</FanAction>;
  if (resource.state.status !== "ready") return <ParticipationState locale={locale} status={resource.state.status} retry={resource.retry} />;
  const data = resource.state.data;
  return <>{data.items.length ? <ul className={styles.list}>{data.items.map(item => <li key={item.id} className={`${styles.row} ${item.id === highlightId ? styles.highlight : ""}`}>
    <span className={styles.badge}>{c[item.status]}</span><h3>{"title" in item ? item.title : item.name}</h3>
    <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(item.createdAt))}</time>
    {item.reviewReason && <p>{c.reason}: {item.reviewReason}</p>}
    {"scheduleHref" in item && item.scheduleHref ? <FanAction href={`${item.scheduleHref}?locale=${locale}`}>{c.view}</FanAction> : "artist" in item && item.artist ? <FanAction href={`${item.artist.href}?locale=${locale}`}>{item.artist.name}</FanAction> : null}
  </li>)}</ul> : <FanState kind="empty" title={c.empty} icon={tab === "schedules" ? <CalendarDays aria-hidden="true" /> : <FileText aria-hidden="true" />} actions={<FanAction href={`${tab === "schedules" ? "/live/calendar" : "/bias/requests"}?locale=${locale}`}>{tab === "schedules" ? c.schedules : c.fanpage}</FanAction>} />}
    <div className={styles.actions}>{cursor && <FanAction onClick={() => setCursor(null)}>{c.back}</FanAction>}{data.nextCursor && <FanAction onClick={() => setCursor(data.nextCursor)}>{c.more}</FanAction>}</div>
  </>;
}
