"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { type AppLocale, toContentLocale } from "@/i18n/locales";
import { personalCopy } from "@/i18n/catalogs/features__my__ui__personal-copy";
import { withLocalePath } from "@/components/locale-path";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { historyPageSchema, type HistoryKind, type HistoryPage } from "../domain/fan-history";
import { rewardStatusCopy } from "./my-screen";
import styles from "./fan-history-screen.module.css";

export function FanHistoryScreen({ locale, kind }: { locale: AppLocale; kind: HistoryKind }) {
  const auth = usePrivy();
  return <OwnerHistory key={`${auth.user?.id ?? "guest"}:${locale}:${kind}`} locale={locale} kind={kind} auth={auth}/>;
}
function OwnerHistory({ locale, kind, auth }: { locale: AppLocale; kind: HistoryKind; auth: ReturnType<typeof usePrivy> }) {
  const t = personalCopy[locale];
  const parse = useCallback((value: unknown) => historyPageSchema.parse(value), []);
  const baseUrl = `/api/me/activity?kind=${kind}&locale=${toContentLocale(locale)}`;
  const resource = useOwnedFanResource(baseUrl, parse, auth);
  const [pages, setPages] = useState<HistoryPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const first = resource.state.status === "ready" ? resource.state.data : null;
  const next = pages.length ? pages.at(-1)!.nextCursor : first?.nextCursor;
  const rows = [...new Map([...(first?.items ?? []), ...pages.flatMap(page => page.items)].map(row => [row.id, row])).values()];
  async function more() {
    if (!next || controller.current) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setFailed(false);
    try {
      const token = await auth.getAccessToken();
      if (!token || !alive.current) throw new Error("Session unavailable");
      const response = await fetch(`${baseUrl}&cursor=${encodeURIComponent(next)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal });
      if (!response.ok) throw new Error("History unavailable");
      const page = parse(await response.json());
      if (alive.current) setPages(current => [...current, page]);
    } catch { if (alive.current) setFailed(true); }
    finally { controller.current = null; if (alive.current) setBusy(false); }
  }
  const returnTo = `/my/activity?kind=${kind}&locale=${locale}`;
  return <FanAppFrame locale={locale} currentPath="/my" mainId="activity-history"><FanContentContainer as="main" id="activity-history" className={styles.main} tabIndex={-1}>
    <Link className={styles.back} href={`/my?locale=${locale}`}><ArrowLeft aria-hidden="true"/>{t.back}</Link><h1>{t.title}</h1>
    <nav className={styles.tabs} aria-label={t.title}>{(["applications", "rewards", "collection"] as const).map(tab => <Link key={tab} aria-current={kind === tab ? "page" : undefined} href={`/my/activity?kind=${tab}&locale=${locale}` as Route}>{t[tab]}</Link>)}<Link href={`/my/raffles?locale=${locale}`}>{t.raffles}</Link></nav>
    {!auth.ready ? <FanState kind="loading" title={t.loading}/> : !auth.authenticated ? <FanAction href={`/login?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}` as Route}>{t.login}</FanAction>
      : resource.state.status === "loading" ? <FanState kind="loading" title={t.loading}/>
      : resource.state.status === "error" ? <FanState kind="error" title={t.error} actions={<FanAction onClick={resource.retry}>{t.retry}</FanAction>}/>
      : <><ul className={styles.rows}>{rows.map(row => <li key={row.id}><Link href={withLocalePath(row.href, locale) as Route}><strong>{row.title}</strong><span>{row.status in rewardStatusCopy ? rewardStatusCopy[row.status as keyof typeof rewardStatusCopy][locale] : t[row.status as "submitted" | "selected" | "cancelled" | "collected"]}</span><time dateTime={row.occurredAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(row.occurredAt))}</time></Link></li>)}</ul>{!rows.length ? <FanState kind="empty" title={t.empty} actions={<FanAction href={kind === "collection" ? `/passports?locale=${locale}` as Route : `/benefits?locale=${locale}` as Route}>{kind === "collection" ? t.collection : t.rewards}</FanAction>}/> : null}
        {failed ? <p role="alert">{t.error}</p> : null}{next ? <FanAction disabled={busy} onClick={() => void more()}>{busy ? t.loading : failed ? t.retry : t.more}</FanAction> : null}</>}
  </FanContentContainer></FanAppFrame>;
}
