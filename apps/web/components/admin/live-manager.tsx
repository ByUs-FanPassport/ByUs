"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Archive, CirclePlus, Eye, Radio, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./live-manager.module.css";

type Ref = { id: string; slug: string; status: "draft" | "published"; nameKo: string; nameEn: string };
type Localization = { title: string; summary: string; heroAlt: string };
type Live = { id: string; slug: string; celebrityId: string; brandId: string; publicationStatus: "draft" | "published"; effectiveStatus: string; startsAt: string; endsAt: string; reservationOpensAt: string; reservationClosesAt: string; youtubeUrl: string; heroUrl: string; fanCodeConfigured: boolean; archivedAt: string | null; archiveReason: string | null; localizations: { ko: Localization; en: Localization }; overrides: Array<{ id: string; status: string; reason: string; effectiveFrom: string; effectiveUntil: string | null }> };
type Data = { lives: Live[]; celebrities: Ref[]; brands: Ref[] };
type Form = { id: string; slug: string; celebrityId: string; brandId: string; startsAt: string; endsAt: string; reservationOpensAt: string; reservationClosesAt: string; youtubeUrl: string; heroUrl: string; fanCode: string; titleKo: string; summaryKo: string; heroAltKo: string; titleEn: string; summaryEn: string; heroAltEn: string };

const empty: Form = { id: "", slug: "", celebrityId: "", brandId: "", startsAt: "", endsAt: "", reservationOpensAt: "", reservationClosesAt: "", youtubeUrl: "", heroUrl: "", fanCode: "", titleKo: "", summaryKo: "", heroAltKo: "", titleEn: "", summaryEn: "", heroAltEn: "" };
const copy = {
  ko: { title: "라이브 관리", description: "라이브 초안, 공개 상태와 실제 진행 상태를 한곳에서 관리합니다.", newLive: "새 라이브", list: "라이브 목록", empty: "등록된 라이브가 없습니다.", basic: "연결 및 일정", content: "한국어 · English", security: "Fan Code는 저장 후 다시 표시되지 않습니다.", save: "초안 저장", publish: "발행", unpublish: "발행 취소", archive: "보관", override: "상태 변경", preview: "팬 화면 미리보기", loading: "라이브를 불러오는 중입니다.", failure: "라이브 데이터를 불러오지 못했습니다.", saved: "변경사항을 저장했습니다.", readonly: "Viewer 권한은 조회만 가능합니다.", archived: "보관됨", utc: "UTC 기준 ISO 시각으로 저장됩니다.", confirmOverride: "이 상태 변경은 이력에 영구 기록됩니다. 계속할까요?", archiveReason: "보관 사유 (10자 이상)", overrideReason: "상태 변경 사유", from: "적용 시작 (UTC)", until: "적용 종료 (UTC, 종료 상태는 비움)" },
  en: { title: "Live manager", description: "Manage live drafts, publication, and effective operational status in one place.", newLive: "New live", list: "Lives", empty: "No live events have been created.", basic: "Relationships and schedule", content: "Korean · English", security: "The Fan Code is never shown again after it is saved.", save: "Save draft", publish: "Publish", unpublish: "Unpublish", archive: "Archive", override: "Change status", preview: "Fan preview", loading: "Loading lives.", failure: "Live data could not be loaded.", saved: "Changes saved.", readonly: "Viewer access is read-only.", archived: "Archived", utc: "Times are stored as UTC ISO instants.", confirmOverride: "This status decision is permanently recorded. Continue?", archiveReason: "Archive reason (10+ characters)", overrideReason: "Status change reason", from: "Effective from (UTC)", until: "Effective until (UTC; blank for terminal)" },
} as const;

function local(iso: string) { return iso ? new Date(iso).toISOString().slice(0, 16) : ""; }
function instant(value: string) { return new Date(`${value}:00Z`).toISOString(); }
function formFor(live: Live): Form { return { id: live.id, slug: live.slug, celebrityId: live.celebrityId, brandId: live.brandId, startsAt: local(live.startsAt), endsAt: local(live.endsAt), reservationOpensAt: local(live.reservationOpensAt), reservationClosesAt: local(live.reservationClosesAt), youtubeUrl: live.youtubeUrl, heroUrl: live.heroUrl, fanCode: "", titleKo: live.localizations.ko.title, summaryKo: live.localizations.ko.summary, heroAltKo: live.localizations.ko.heroAlt, titleEn: live.localizations.en.title, summaryEn: live.localizations.en.summary, heroAltEn: live.localizations.en.heroAlt }; }

export function AuthorizedLiveManager() {
  const locale: AdminLocale = useSearchParams().get("lang") === "en" ? "en" : "ko";
  const session = useAdminSession();
  if (session.status !== "authorized") return <AdminAccessState locale={locale} status={session.status} />;
  return <LiveManager locale={locale} role={session.admin.role} />;
}

function LiveManager({ locale, role }: { locale: AdminLocale; role: string }) {
  const { getAccessToken } = usePrivy(); const t = copy[locale]; const canWrite = role !== "viewer";
  const [data, setData] = useState<Data | null>(null); const [form, setForm] = useState<Form>(empty);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"); const [message, setMessage] = useState("");
  const [archiveReason, setArchiveReason] = useState(""); const [pending, setPending] = useState(false); const [override, setOverride] = useState({ status: "live", effectiveFrom: "", effectiveUntil: "", reason: "" });
  const selected = data?.lives.find((live) => live.id === form.id);

  const request = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    const token = await getAccessToken(); if (!token) throw new Error("auth");
    const response = await fetch("/api/admin/lives", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status)); return response.json();
  }, [getAccessToken]);
  const refresh = useCallback(async () => { try { setStatus("loading"); const next = await request("GET") as Data; setData(next); setStatus("ready"); } catch { setStatus("error"); } }, [request]);
  useEffect(() => { void refresh(); }, [refresh]);
  const preview = useMemo(() => ({ title: form[locale === "ko" ? "titleKo" : "titleEn"], summary: form[locale === "ko" ? "summaryKo" : "summaryEn"], alt: form[locale === "ko" ? "heroAltKo" : "heroAltEn"] }), [form, locale]);
  function update(name: keyof Form, value: string) { setForm((current) => ({ ...current, [name]: value })); }
  async function command(body: unknown) { if (pending) return; try { setPending(true); setMessage(""); await request("POST", body); setMessage(t.saved); await refresh(); } catch { setMessage(t.failure); } finally { setPending(false); } }
  async function submit(event: React.FormEvent) { event.preventDefault(); await command({ action: "save", ...form, id: form.id || null, startsAt: instant(form.startsAt), endsAt: instant(form.endsAt), reservationOpensAt: instant(form.reservationOpensAt), reservationClosesAt: instant(form.reservationClosesAt) }); }
  async function applyOverride() { if (!selected || !window.confirm(t.confirmOverride)) return; await command({ action: "override", id: selected.id, status: override.status, effectiveFrom: instant(override.effectiveFrom), effectiveUntil: override.effectiveUntil ? instant(override.effectiveUntil) : "", reason: override.reason }); }
  async function applyArchive() { if (!selected || !window.confirm(`${t.archive}: ${selected.localizations[locale].title}\n${archiveReason}`)) return; await command({ action: "archive", id: selected.id, reason: archiveReason }); }

  return <AdminOperationsShell locale={locale}><div className={styles.heading}><div><p>ADM-005</p><h1>{t.title}</h1><span>{t.description}</span></div><button type="button" onClick={() => setForm(empty)} disabled={!canWrite || pending}><CirclePlus aria-hidden="true" />{t.newLive}</button></div>
    {!canWrite && <p className={styles.notice} role="status">{t.readonly}</p>}{message && <p className={styles.notice} role="status">{message}</p>}
    {status === "loading" && <div className={styles.skeleton} aria-busy="true">{t.loading}</div>}
    {status === "error" && <div className={styles.error} role="alert">{t.failure}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {status === "ready" && data && <div className={styles.layout}>
      <section className={styles.list} aria-labelledby="live-list"><h2 id="live-list">{t.list}<span>{data.lives.length}</span></h2>{data.lives.length === 0 ? <p className={styles.empty}>{t.empty}</p> : <ul>{data.lives.map((live) => <li key={live.id}><button type="button" className={form.id === live.id ? styles.selected : ""} onClick={() => setForm(formFor(live))}><span><strong>{live.localizations[locale].title}</strong><small>{live.slug}</small></span><i data-status={live.archivedAt ? "archived" : live.publicationStatus}>{live.archivedAt ? t.archived : live.publicationStatus}</i></button></li>)}</ul>}</section>
      <section className={styles.editor} aria-label={t.title} aria-busy={pending}><form onSubmit={submit}><fieldset disabled={!canWrite || pending || Boolean(selected?.archivedAt)}><legend>{t.basic}</legend><div className={styles.grid}><Field label="Slug" value={form.slug} onChange={(v) => update("slug", v)} required /><Select label="Celebrity" value={form.celebrityId} onChange={(v) => update("celebrityId", v)} refs={data.celebrities} locale={locale} /><Select label="Brand" value={form.brandId} onChange={(v) => update("brandId", v)} refs={data.brands} locale={locale} /><Field label="YouTube URL" type="url" value={form.youtubeUrl} onChange={(v) => update("youtubeUrl", v)} required /><Field label="Hero URL" value={form.heroUrl} onChange={(v) => update("heroUrl", v)} required /><Field label="Fan Code" type="password" value={form.fanCode} onChange={(v) => update("fanCode", v)} required={!form.id} /></div><p>{t.security}</p><div className={styles.timeGrid}><Field label="Reservation opens (UTC)" type="datetime-local" value={form.reservationOpensAt} onChange={(v) => update("reservationOpensAt", v)} required /><Field label="Reservation closes (UTC)" type="datetime-local" value={form.reservationClosesAt} onChange={(v) => update("reservationClosesAt", v)} required /><Field label="Starts (UTC)" type="datetime-local" value={form.startsAt} onChange={(v) => update("startsAt", v)} required /><Field label="Ends (UTC)" type="datetime-local" value={form.endsAt} onChange={(v) => update("endsAt", v)} required /></div><p>{t.utc}</p></fieldset>
        <fieldset disabled={!canWrite || pending || Boolean(selected?.archivedAt)}><legend>{t.content}</legend><div className={styles.localeGrid}><LocaleFields language="한국어" title={form.titleKo} summary={form.summaryKo} alt={form.heroAltKo} set={(key,v) => update(`${key}Ko` as keyof Form,v)} /><LocaleFields language="English" title={form.titleEn} summary={form.summaryEn} alt={form.heroAltEn} set={(key,v) => update(`${key}En` as keyof Form,v)} /></div></fieldset>
        <div className={styles.actions}><button type="submit" disabled={!canWrite || pending || Boolean(selected?.archivedAt)}><Save aria-hidden="true" />{t.save}</button>{selected && !selected.archivedAt && <button type="button" onClick={() => void command({ action: selected.publicationStatus === "published" ? "unpublish" : "publish", id: selected.id })} disabled={!canWrite || pending}>{selected.publicationStatus === "published" ? t.unpublish : t.publish}</button>}</div></form>
        <section className={styles.preview}><h2><Eye aria-hidden="true" />{t.preview}</h2><div className={styles.hero} style={form.heroUrl ? { backgroundImage: `linear-gradient(90deg, rgb(0 0 0 / .72), transparent), url(${JSON.stringify(form.heroUrl).slice(1,-1)})` } : undefined}><span>{selected?.effectiveStatus ?? "scheduled"}</span><h3>{preview.title || "Live title"}</h3><p>{preview.summary || "Live summary"}</p><small>{preview.alt}</small></div></section>
        {selected && !selected.archivedAt && <section className={styles.operations}><div><h2><Radio aria-hidden="true" />{t.override}</h2><select disabled={pending} aria-label={t.override} value={override.status} onChange={(e) => setOverride({...override,status:e.target.value})}><option>scheduled</option><option>live</option><option>ended</option><option>cancelled</option></select><Field label={t.from} type="datetime-local" value={override.effectiveFrom} onChange={(v) => setOverride({...override,effectiveFrom:v})} required /><Field label={t.until} type="datetime-local" value={override.effectiveUntil} onChange={(v) => setOverride({...override,effectiveUntil:v})} /><Field label={t.overrideReason} value={override.reason} onChange={(v) => setOverride({...override,reason:v})} required /><button type="button" disabled={!canWrite || pending || !override.effectiveFrom || !override.reason} onClick={() => void applyOverride()}>{t.override}</button></div><div><h2><Archive aria-hidden="true" />{t.archive}</h2><Field label={t.archiveReason} value={archiveReason} onChange={setArchiveReason} required /><button className={styles.danger} type="button" disabled={!canWrite || pending || archiveReason.trim().length < 10} onClick={() => void applyArchive()}>{t.archive}</button></div></section>}
      </section></div>}
  </AdminOperationsShell>;
}

function Field({ label, value, onChange, type="text", required=false }: { label: string; value: string; onChange(v:string):void; type?: string; required?: boolean }) { return <label><span>{label}</span><input type={type} value={value} onChange={(e)=>onChange(e.target.value)} required={required} /></label>; }
function Select({ label,value,onChange,refs,locale }: { label:string;value:string;onChange(v:string):void;refs:Ref[];locale:AdminLocale }) { return <label><span>{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)} required><option value="">—</option>{refs.map((ref)=><option key={ref.id} value={ref.id}>{locale === "ko" ? ref.nameKo : ref.nameEn} · {ref.status}</option>)}</select></label>; }
function LocaleFields({language,title,summary,alt,set}:{language:string;title:string;summary:string;alt:string;set(key:"title"|"summary"|"heroAlt",value:string):void}) { return <div><h3>{language}</h3><Field label="Title" value={title} onChange={(v)=>set("title",v)} required /><label><span>Summary</span><textarea value={summary} onChange={(e)=>set("summary",e.target.value)} required /></label><Field label="Hero alt" value={alt} onChange={(v)=>set("heroAlt",v)} required /></div>; }
