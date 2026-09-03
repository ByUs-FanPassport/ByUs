"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Archive, CirclePlus, Copy, Eye, KeyRound, Radio, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rewardPolicyForVersion } from "../../features/rewards/domain/reward-policy";
import {
  EXTERNAL_LIVE_PROVIDERS,
  type ExternalLiveProvider,
} from "../../features/live/domain/live-event";
import {
  kstDateTimeLocalToInstant,
  liveScheduleRevisionSchema,
  toKstDateTimeLocal,
} from "../../features/live/domain/live-schedule";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./live-manager.module.css";

type Ref = { id: string; slug: string; status: "draft" | "published"; nameKo: string; nameEn: string };
type Localization = { title: string; summary: string; heroAlt: string };
type Preview = { id: string; kind: "artist_teaser" | "event_highlight"; publicationStatus: "draft" | "published"; durationMs: number; sourceSha256: string; focal: { x: number; y: number }; squareVideoUrl: string; squarePosterUrl: string; landscapeVideoUrl: string; landscapePosterUrl: string; rightsHolder: string; rightsBasis: string; sourceReference: string; processedAt: string; archivedAt: string | null; archiveReason: string | null; revision: number };
type Live = { id: string; slug: string; celebrityId: string; brandId: string; publicationStatus: "draft" | "published"; effectiveStatus: string; startsAt: string; endsAt: string; reservationOpensAt: string; reservationClosesAt: string; attendanceValidFrom: string; attendanceValidUntil: string; scheduleRevision: number; everPublishedAt: string | null; liveProvider?: ExternalLiveProvider; externalLiveUrl?: string; youtubeUrl: string; heroUrl: string; fanCodeConfigured: boolean; archivedAt: string | null; archiveReason: string | null; preview: Preview | null; localizations: { ko: Localization; en: Localization }; overrides: Array<{ id: string; status: string; reason: string; effectiveFrom: string; effectiveUntil: string | null }> };
type RewardSettings = { liveEventId: string; effectiveStatus: string; revisionId: string; revision: number; status: "draft" | "published"; policyVersion: number; missionScore: number; missionTicket: number; journeyBonusTicket: number; configuredLiveScoreMaximum: number; projectedLiveTicketMaximum: number; passportVerificationTicket: number; passportKnowledgeScoreIncluded: boolean; missionTicketIssuanceDeferred: boolean };
type Data = { lives: Live[]; celebrities: Ref[]; brands: Ref[]; rewardSettings: RewardSettings[] };
type Form = { id: string; slug: string; celebrityId: string; brandId: string; startsAt: string; endsAt: string; reservationOpensAt: string; reservationClosesAt: string; attendanceValidFrom: string; attendanceValidUntil: string; liveProvider: ExternalLiveProvider; externalLiveUrl: string; heroUrl: string; titleKo: string; summaryKo: string; heroAltKo: string; titleEn: string; summaryEn: string; heroAltEn: string };

const empty: Form = { id: "", slug: "", celebrityId: "", brandId: "", startsAt: "", endsAt: "", reservationOpensAt: "", reservationClosesAt: "", attendanceValidFrom: "", attendanceValidUntil: "", liveProvider: "youtube", externalLiveUrl: "", heroUrl: "", titleKo: "", summaryKo: "", heroAltKo: "", titleEn: "", summaryEn: "", heroAltEn: "" };
const providerLabel: Record<ExternalLiveProvider, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};
const copy = {
  ko: { title: "라이브 관리", description: "라이브 초안, 공개 상태와 실제 진행 상태를 한곳에서 관리합니다.", newLive: "새 라이브", list: "라이브 목록", empty: "등록된 라이브가 없습니다.", basic: "연결 및 일정", content: "한국어 · English", reward: "보상 설정", rewardHelp: "Survey 버전이 발행될 때 당시 공개된 설정이 고정됩니다. Mission Ticket 지급은 다음 Phase에서 연결됩니다.", rewardSave: "보상 초안 저장", rewardPublish: "보상 설정 공개", security: "Fan Code는 저장 후 다시 표시되지 않습니다.", save: "초안 저장", reschedule: "일정 변경", rescheduleReason: "일정 변경 사유", publish: "발행", unpublish: "발행 취소", archive: "보관", override: "상태 변경", preview: "팬 화면 미리보기", previewMedia: "Active Preview", previewEmpty: "등록된 Preview가 없습니다. 권리 확보 원본은 CLI에서 먼저 변환·등록해 주세요.", previewPublish: "Preview 공개", previewUnpublish: "Preview 비공개", previewArchive: "Preview 보관", loading: "라이브를 불러오는 중입니다.", failure: "라이브 데이터를 불러오지 못했습니다.", saved: "변경사항을 저장했습니다.", readonly: "Viewer 권한은 조회만 가능합니다.", archived: "보관됨", kst: "모든 일정은 한국 표준시(KST)로 입력합니다.", confirmOverride: "이 상태 변경은 이력에 영구 기록됩니다. 계속할까요?", archiveReason: "보관 사유 (10자 이상)", overrideReason: "상태 변경 사유", from: "적용 시작 (KST)", until: "적용 종료 (KST, 종료 상태는 비움)" },
  en: { title: "Live manager", description: "Manage live drafts, publication, and effective operational status in one place.", newLive: "New live", list: "Lives", empty: "No live events have been created.", basic: "Relationships and schedule", content: "Korean · English", reward: "Reward settings", rewardHelp: "Publishing a Survey freezes the reward settings published at that moment. Mission Ticket issuance is deferred to the next phase.", rewardSave: "Save reward draft", rewardPublish: "Publish reward settings", security: "The Fan Code is never shown again after it is saved.", save: "Save draft", reschedule: "Reschedule", rescheduleReason: "Reason for rescheduling", publish: "Publish", unpublish: "Unpublish", archive: "Archive", override: "Change status", preview: "Fan preview", previewMedia: "Active Preview", previewEmpty: "No Preview is registered. Prepare and register rights-cleared source media with the CLI first.", previewPublish: "Publish Preview", previewUnpublish: "Unpublish Preview", previewArchive: "Archive Preview", loading: "Loading lives.", failure: "Live data could not be loaded.", saved: "Changes saved.", readonly: "Viewer access is read-only.", archived: "Archived", kst: "Enter every schedule in Korea Standard Time (KST).", confirmOverride: "This status decision is permanently recorded. Continue?", archiveReason: "Archive reason (10+ characters)", overrideReason: "Status change reason", from: "Effective from (KST)", until: "Effective until (KST; blank for terminal)" },
} as const;

function formFor(live: Live): Form { return { id: live.id, slug: live.slug, celebrityId: live.celebrityId, brandId: live.brandId, startsAt: toKstDateTimeLocal(live.startsAt), endsAt: toKstDateTimeLocal(live.endsAt), reservationOpensAt: toKstDateTimeLocal(live.reservationOpensAt), reservationClosesAt: toKstDateTimeLocal(live.reservationClosesAt), attendanceValidFrom: toKstDateTimeLocal(live.attendanceValidFrom), attendanceValidUntil: toKstDateTimeLocal(live.attendanceValidUntil), liveProvider: live.liveProvider ?? "youtube", externalLiveUrl: live.externalLiveUrl ?? live.youtubeUrl, heroUrl: live.heroUrl, titleKo: live.localizations.ko.title, summaryKo: live.localizations.ko.summary, heroAltKo: live.localizations.ko.heroAlt, titleEn: live.localizations.en.title, summaryEn: live.localizations.en.summary, heroAltEn: live.localizations.en.heroAlt }; }

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
  const [generatedCode, setGeneratedCode] = useState("");
  const [archiveReason, setArchiveReason] = useState(""); const [pending, setPending] = useState(false); const [override, setOverride] = useState({ status: "live", effectiveFrom: "", effectiveUntil: "", reason: "" });
  const [rescheduleReason, setRescheduleReason] = useState("");
  const selected = data?.lives.find((live) => live.id === form.id);
  const canSaveDraft = !selected || (selected.publicationStatus === "draft" && !selected.everPublishedAt);
  const canReschedule = Boolean(selected && selected.publicationStatus === "published" && selected.effectiveStatus === "scheduled" && !selected.archivedAt && selected.scheduleRevision > 0);
  const reward = data?.rewardSettings.find((item) => item.liveEventId === form.id);
  const [rewardDraft, setRewardDraft] = useState({ missionScore: 1, missionTicket: 1, journeyBonusTicket: 3 });
  const rewardPolicy = reward ? rewardPolicyForVersion(reward.policyVersion) : null;

  const request = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    const token = await getAccessToken(); if (!token) throw new Error("auth");
    const response = await fetch("/api/admin/lives", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status)); return response.json();
  }, [getAccessToken]);
  const refresh = useCallback(async () => { try { setStatus("loading"); const next = await request("GET") as Data; setData(next); setStatus("ready"); } catch { setStatus("error"); } }, [request]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!reward) return;
    setRewardDraft({ missionScore: reward.missionScore, missionTicket: reward.missionTicket, journeyBonusTicket: reward.journeyBonusTicket });
  }, [reward]);
  const preview = useMemo(() => ({ title: form[locale === "ko" ? "titleKo" : "titleEn"], summary: form[locale === "ko" ? "summaryKo" : "summaryEn"], alt: form[locale === "ko" ? "heroAltKo" : "heroAltEn"] }), [form, locale]);
  function update(name: keyof Form, value: string) { setForm((current) => ({ ...current, [name]: value })); }
  async function command(body: unknown) { if (pending) return null; try { setPending(true); setMessage(""); const result = await request("POST", body); setMessage(t.saved); await refresh(); return result as Record<string,string>; } catch { setMessage(t.failure); return null; } finally { setPending(false); } }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (canSaveDraft) {
      const result = await command({ action: "save", ...form, id: form.id || null, startsAt: kstDateTimeLocalToInstant(form.startsAt), endsAt: kstDateTimeLocalToInstant(form.endsAt), reservationOpensAt: kstDateTimeLocalToInstant(form.reservationOpensAt), reservationClosesAt: kstDateTimeLocalToInstant(form.reservationClosesAt) });
      if (result?.fanCode) setGeneratedCode(result.fanCode);
      return;
    }
    if (!selected || !canReschedule) return;
    const revision = liveScheduleRevisionSchema.safeParse({
      liveEventId: selected.id,
      expectedRevision:selected.scheduleRevision,
      reason: rescheduleReason,
      reservationOpensAt: kstDateTimeLocalToInstant(form.reservationOpensAt),
      reservationClosesAt: kstDateTimeLocalToInstant(form.reservationClosesAt),
      startsAt: kstDateTimeLocalToInstant(form.startsAt),
      endsAt: kstDateTimeLocalToInstant(form.endsAt),
      attendanceValidFrom: kstDateTimeLocalToInstant(form.attendanceValidFrom),
      attendanceValidUntil: kstDateTimeLocalToInstant(form.attendanceValidUntil),
    });
    if (!revision.success) { setMessage(t.failure); return; }
    const result = await command({ action: "reschedule", ...revision.data });
    if (result) setRescheduleReason("");
  }
  async function generateAttendanceCode() {
    if (!selected) return;
    const fixedWindow = selected.everPublishedAt
      ? { validFrom: selected.attendanceValidFrom, validUntil: selected.attendanceValidUntil }
      : { validFrom: kstDateTimeLocalToInstant(form.attendanceValidFrom), validUntil: kstDateTimeLocalToInstant(form.attendanceValidUntil) };
    const result = await command({ action: "generate_attendance_code", liveEventId:selected.id, ...fixedWindow });
    if (result?.fanCode) setGeneratedCode(result.fanCode);
  }
  async function applyOverride() { if (!selected || !window.confirm(t.confirmOverride)) return; await command({ action: "override", id: selected.id, status: override.status, effectiveFrom: kstDateTimeLocalToInstant(override.effectiveFrom), effectiveUntil: override.effectiveUntil ? kstDateTimeLocalToInstant(override.effectiveUntil) : "", reason: override.reason }); }
  async function applyArchive() { if (!selected || !window.confirm(`${t.archive}: ${selected.localizations[locale].title}\n${archiveReason}`)) return; await command({ action: "archive", id: selected.id, reason: archiveReason }); }
  function choose(live: Live) { setGeneratedCode(""); setRescheduleReason(""); setForm(formFor(live)); }

  return <AdminOperationsShell locale={locale}><div className={styles.heading}><div><p>ADM-005</p><h1>{t.title}</h1><span>{t.description}</span></div><button type="button" onClick={() => { setForm(empty); setRescheduleReason(""); }} disabled={!canWrite || pending}><CirclePlus aria-hidden="true" />{t.newLive}</button></div>
    {!canWrite && <p className={styles.notice} role="status">{t.readonly}</p>}{message && <p className={styles.notice} role="status">{message}</p>}
    {status === "loading" && <div className={styles.skeleton} aria-busy="true">{t.loading}</div>}
    {status === "error" && <div className={styles.error} role="alert">{t.failure}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {status === "ready" && data && <div className={styles.layout}>
      <section className={styles.list} aria-labelledby="live-list"><h2 id="live-list">{t.list}<span>{data.lives.length}</span></h2>{data.lives.length === 0 ? <p className={styles.empty}>{t.empty}</p> : <ul>{data.lives.map((live) => <li key={live.id}><button type="button" className={form.id === live.id ? styles.selected : ""} onClick={() => choose(live)}><span><strong>{live.localizations[locale].title}</strong><small>{live.slug} · schedule r{live.scheduleRevision}</small></span><i data-status={live.archivedAt ? "archived" : live.publicationStatus}>{live.archivedAt ? t.archived : live.publicationStatus}</i></button></li>)}</ul>}</section>
      <section className={styles.editor} aria-label={t.title} aria-busy={pending}><form onSubmit={submit}><fieldset disabled={!canWrite || pending || Boolean(selected?.archivedAt) || (!canSaveDraft && !canReschedule)}><legend>{t.basic}</legend><div className={styles.grid}><Field label="Slug" value={form.slug} onChange={(v) => update("slug", v)} disabled={!canSaveDraft} required /><Select label="Celebrity" value={form.celebrityId} onChange={(v) => update("celebrityId", v)} refs={data.celebrities} locale={locale} disabled={!canSaveDraft} /><Select label="Brand" value={form.brandId} onChange={(v) => update("brandId", v)} refs={data.brands} locale={locale} disabled={!canSaveDraft} /><label><span>LIVE Provider</span><select value={form.liveProvider} onChange={(event) => update("liveProvider", event.target.value)} disabled={!canSaveDraft} required>{EXTERNAL_LIVE_PROVIDERS.map((provider) => <option key={provider} value={provider}>{providerLabel[provider]}</option>)}</select></label><Field label="External LIVE URL" type="url" value={form.externalLiveUrl} onChange={(v) => update("externalLiveUrl", v)} disabled={!canSaveDraft} required /><Field label="Hero URL" value={form.heroUrl} onChange={(v) => update("heroUrl", v)} disabled={!canSaveDraft} required /></div><div className={styles.timeGrid}><Field label="Reservation opens (KST)" type="datetime-local" value={form.reservationOpensAt} onChange={(v) => update("reservationOpensAt", v)} required /><Field label="Reservation closes (KST)" type="datetime-local" value={form.reservationClosesAt} onChange={(v) => update("reservationClosesAt", v)} required /><Field label="Starts (KST)" type="datetime-local" value={form.startsAt} onChange={(v) => update("startsAt", v)} required /><Field label="Ends (KST)" type="datetime-local" value={form.endsAt} onChange={(v) => update("endsAt", v)} required /></div><p>{t.kst}</p></fieldset>
        <fieldset disabled={!canWrite || pending || Boolean(selected?.archivedAt) || !canSaveDraft}><legend>{t.content}</legend><div className={styles.localeGrid}><LocaleFields language="한국어" title={form.titleKo} summary={form.summaryKo} alt={form.heroAltKo} set={(key,v) => update(`${key}Ko` as keyof Form,v)} /><LocaleFields language="English" title={form.titleEn} summary={form.summaryEn} alt={form.heroAltEn} set={(key,v) => update(`${key}En` as keyof Form,v)} /></div></fieldset>
        {canReschedule && <fieldset disabled={!canWrite || pending}><legend>{t.reschedule} · r{selected?.scheduleRevision}</legend><Field label={t.rescheduleReason} value={rescheduleReason} onChange={setRescheduleReason} required /></fieldset>}<div className={styles.actions}>{canSaveDraft && <button type="submit" disabled={!canWrite || pending || Boolean(selected?.archivedAt)}><Save aria-hidden="true" />{t.save}</button>}{canReschedule && <button type="submit" disabled={!canWrite || pending || !rescheduleReason.trim()}><Save aria-hidden="true" />{t.reschedule}</button>}{selected && !selected.archivedAt && <><button type="button" onClick={() => void command({ action: selected.publicationStatus === "published" ? "unpublish" : "publish", id: selected.id })} disabled={!canWrite || pending}>{selected.publicationStatus === "published" ? t.unpublish : t.publish}</button><a href={`/admin/lives/${selected.id}/missions`}>Mission Builder</a></>}</div></form>
        {selected && !selected.archivedAt && <section className={styles.reward}><div className={styles.rewardHeading}><div><h2><KeyRound aria-hidden="true" />출석 코드</h2><p>{t.security}</p></div><span>{selected.fanCodeConfigured ? "configured" : "not configured"}</span></div><fieldset disabled={!canWrite || pending || selected.effectiveStatus === "ended" || selected.effectiveStatus === "cancelled"}><div className={styles.timeGrid}><Field label="Attendance opens (KST)" type="datetime-local" value={form.attendanceValidFrom} onChange={(v)=>update("attendanceValidFrom",v)} disabled={Boolean(selected.everPublishedAt)} required /><Field label="Attendance closes (KST)" type="datetime-local" value={form.attendanceValidUntil} onChange={(v)=>update("attendanceValidUntil",v)} disabled={Boolean(selected.everPublishedAt)} required /></div><div className={styles.actions}><button type="button" onClick={()=>void generateAttendanceCode()} disabled={!form.attendanceValidFrom || !form.attendanceValidUntil}>출석 코드 생성</button>{generatedCode && <><strong aria-live="polite">{generatedCode}</strong><button type="button" onClick={()=>void navigator.clipboard.writeText(generatedCode)}><Copy aria-hidden="true" />복사</button></>}</div></fieldset></section>}
        {selected && reward && rewardPolicy && <section className={styles.reward}><div className={styles.rewardHeading}><div><h2>{t.reward}</h2><p>{t.rewardHelp}</p></div><span data-status={reward.status}>v{reward.policyVersion} · r{reward.revision} · {reward.status}</span></div><fieldset disabled={!canWrite || pending || Boolean(selected.archivedAt) || selected.effectiveStatus === "ended"}><div className={styles.rewardGrid}><NumberField label="Mission Score" value={rewardDraft.missionScore} min={rewardPolicy.mission.minimumScore} max={rewardPolicy.mission.maximumScore} onChange={(missionScore) => setRewardDraft({...rewardDraft,missionScore})} /><NumberField label="Mission Ticket" value={rewardDraft.missionTicket} min={rewardPolicy.mission.minimumTicket} max={rewardPolicy.mission.maximumTicket} onChange={(missionTicket) => setRewardDraft({...rewardDraft,missionTicket})} /><NumberField label="Journey Bonus Ticket" value={rewardDraft.journeyBonusTicket} min={rewardPolicy.journey.minimumCompletionTicket} max={rewardPolicy.journey.maximumCompletionTicket} onChange={(journeyBonusTicket) => setRewardDraft({...rewardDraft,journeyBonusTicket})} /></div><dl><div><dt>Configured LIVE Score max</dt><dd>{reward.configuredLiveScoreMaximum}</dd></div><div><dt>Projected Ticket max</dt><dd>{reward.projectedLiveTicketMaximum}</dd></div></dl><div className={styles.actions}><button type="button" onClick={() => void command({ action:"save_reward_settings", liveEventId:selected.id, expectedRevision:reward.revision, ...rewardDraft })}>{t.rewardSave}</button>{reward.status === "draft" && <button type="button" onClick={() => void command({ action:"publish_reward_settings", liveEventId:selected.id, expectedRevision:reward.revision })}>{t.rewardPublish}</button>}</div></fieldset></section>}
        <section className={styles.preview}><h2><Eye aria-hidden="true" />{t.preview}</h2><div className={styles.hero} style={form.heroUrl ? { backgroundImage: `linear-gradient(90deg, rgb(0 0 0 / .72), transparent), url(${JSON.stringify(form.heroUrl).slice(1,-1)})` } : undefined}><span>{selected?.effectiveStatus ?? "scheduled"}</span><h3>{preview.title || "Live title"}</h3><p>{preview.summary || "Live summary"}</p><small>{preview.alt}</small></div></section>
        {selected && <section className={styles.preview}><h2><Eye aria-hidden="true" />{t.previewMedia}</h2>{selected.preview ? <><div className={styles.previewRatios}><figure><video controls muted playsInline preload="metadata" poster={selected.preview.squarePosterUrl} src={selected.preview.squareVideoUrl} /><figcaption>1:1 · {selected.preview.durationMs / 1000}s</figcaption></figure><figure><video controls muted playsInline preload="metadata" poster={selected.preview.landscapePosterUrl} src={selected.preview.landscapeVideoUrl} /><figcaption>2:1 · {selected.preview.kind}</figcaption></figure></div><dl className={styles.previewMeta}><div><dt>Rights</dt><dd>{selected.preview.rightsHolder}</dd></div><div><dt>Source</dt><dd data-wrap-anywhere>{selected.preview.sourceReference}</dd></div></dl>{!selected.preview.archivedAt && <div className={styles.actions}><button type="button" disabled={!canWrite || pending} onClick={() => void command({ action: selected.preview?.publicationStatus === "published" ? "preview_unpublish" : "preview_publish", id: selected.id })}>{selected.preview.publicationStatus === "published" ? t.previewUnpublish : t.previewPublish}</button><button className={styles.danger} type="button" disabled={!canWrite || pending || archiveReason.trim().length < 10} onClick={() => void command({ action: "preview_archive", id: selected.id, reason: archiveReason })}>{t.previewArchive}</button></div>}</> : <p className={styles.empty}>{t.previewEmpty}</p>}</section>}
        {selected && !selected.archivedAt && <section className={styles.operations}><div><h2><Radio aria-hidden="true" />{t.override}</h2><select disabled={pending} aria-label={t.override} value={override.status} onChange={(e) => setOverride({...override,status:e.target.value})}><option>scheduled</option><option>live</option><option>ended</option><option>cancelled</option></select><Field label={t.from} type="datetime-local" value={override.effectiveFrom} onChange={(v) => setOverride({...override,effectiveFrom:v})} required /><Field label={t.until} type="datetime-local" value={override.effectiveUntil} onChange={(v) => setOverride({...override,effectiveUntil:v})} /><Field label={t.overrideReason} value={override.reason} onChange={(v) => setOverride({...override,reason:v})} required /><button type="button" disabled={!canWrite || pending || !override.effectiveFrom || !override.reason} onClick={() => void applyOverride()}>{t.override}</button></div><div><h2><Archive aria-hidden="true" />{t.archive}</h2><Field label={t.archiveReason} value={archiveReason} onChange={setArchiveReason} required /><button className={styles.danger} type="button" disabled={!canWrite || pending || archiveReason.trim().length < 10} onClick={() => void applyArchive()}>{t.archive}</button></div></section>}
      </section></div>}
  </AdminOperationsShell>;
}

function Field({ label, value, onChange, type="text", required=false, disabled=false }: { label: string; value: string; onChange(v:string):void; type?: string; required?: boolean; disabled?: boolean }) { return <label><span>{label}</span><input type={type} value={value} onChange={(e)=>onChange(e.target.value)} required={required} disabled={disabled} /></label>; }
function NumberField({ label, value, onChange, min, max }: { label:string; value:number; onChange(value:number):void; min:number; max:number }) { return <label><span>{label}</span><input type="number" value={value} min={min} max={max} step={1} onChange={(event)=>onChange(Number(event.target.value))} required /></label>; }
function Select({ label,value,onChange,refs,locale,disabled=false }: { label:string;value:string;onChange(v:string):void;refs:Ref[];locale:AdminLocale;disabled?:boolean }) { return <label><span>{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)} disabled={disabled} required><option value="">—</option>{refs.map((ref)=><option key={ref.id} value={ref.id}>{locale === "ko" ? ref.nameKo : ref.nameEn} · {ref.status}</option>)}</select></label>; }
function LocaleFields({language,title,summary,alt,set}:{language:string;title:string;summary:string;alt:string;set(key:"title"|"summary"|"heroAlt",value:string):void}) { return <div><h3>{language}</h3><Field label="Title" value={title} onChange={(v)=>set("title",v)} required /><label><span>Summary</span><textarea value={summary} onChange={(e)=>set("summary",e.target.value)} required /></label><Field label="Hero alt" value={alt} onChange={(v)=>set("heroAlt",v)} required /></div>; }
