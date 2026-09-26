"use client";
import { useState } from "react";
import { z } from "zod";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { pageSchema, adminLiveSubmissionSchema, liveSubmissionSettingsSchema, type AdminLiveSubmission } from "@/features/schedules/domain/participation";
import { localScheduleTime, scheduleInstant } from "@/features/schedules/domain/schedule-time";
import { isRecordedReplayUrl } from "@/features/live/domain/live-watch-link";
import { useParticipationAction, ActionFeedback, ParticipationState } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { useAdminSession } from "./use-admin-session";
import { AdminAccessState } from "./admin-access-state";
import { styles } from "./participation-controls";
const submissionsSchema = pageSchema(adminLiveSubmissionSchema).extend({ settings: liveSubmissionSettingsSchema });
const parse = (value: unknown) => submissionsSchema.parse(value);
const replaySchema = z.object({ liveEventId: z.uuid(), replayProvider: z.string().nullable(), replayUrl: z.string().nullable(), replayPublished: z.boolean(), replayRevision: z.number().int().positive() });
const parseReplay = (value: unknown) => replaySchema.parse(value);
export function AdminLiveSubmissions({ liveEventId, locale }: { liveEventId: string; locale: "ko" | "en" }) {
  const session = useAdminSession();
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  return <Manager key={`${liveEventId}:${session.admin.email}`} liveEventId={liveEventId} locale={locale} readOnly={session.admin.role === "viewer"} />;
}
function Manager({ liveEventId, locale, readOnly }: { liveEventId: string; locale: "ko" | "en"; readOnly: boolean }) {
  const c = participationCopy(locale), action = useParticipationAction(), [cursor, setCursor] = useState<string | null>(null);
  const resource = useFanpageResource(`/api/admin/live-events/${liveEventId}/submissions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, parse);
  const replay = useFanpageResource(`/api/admin/live-events/${liveEventId}/replay`, parseReplay);
  return <section className={styles.panel}><h2>{c.question} · {c.cheer}</h2>
    {resource.state.status !== "ready" ? <ParticipationState locale={locale} status={resource.state.status} retry={resource.retry} /> : <>
      <form key={resource.state.data.settings.revision} className={styles.form} onSubmit={async event => {
        event.preventDefault(); if (resource.state.status !== "ready") return; const data = new FormData(event.currentTarget);
        try { const result = await action.run(`/api/admin/live-events/${liveEventId}/submission-settings`, "PUT", { expectedRevision: resource.state.data.settings.revision, accepting: data.get("accepting") === "on", closesAt: data.get("closesAt") ? scheduleInstant(String(data.get("closesAt")), "Asia/Seoul") : null, visibility: data.get("visibility") }, value => liveSubmissionSettingsSchema.parse(value)); if (result) resource.retry(); } catch { action.setError("INVALID"); }
      }}><fieldset disabled={readOnly || action.busy}><label><span>{c.accepting}</span><input name="accepting" type="checkbox" defaultChecked={resource.state.data.settings.accepting} /></label><label>{c.deadline} (Asia/Seoul)<input name="closesAt" type="datetime-local" defaultValue={resource.state.data.settings.closesAt ? localScheduleTime(resource.state.data.settings.closesAt, "Asia/Seoul") : ""} /></label><label>{c.selected}<select name="visibility" defaultValue={resource.state.data.settings.visibility}><option value="public">{c.publicVisibility}</option><option value="members">{c.memberVisibility}</option></select></label><FanAction type="submit">{c.save}</FanAction></fieldset></form>
      <ul className={styles.list}>{resource.state.data.items.map(item => <Submission key={`${item.id}:${item.revision}`} item={item} locale={locale} readOnly={readOnly} refresh={resource.retry} />)}</ul>
      {!resource.state.data.items.length && <p>{c.empty}</p>}<div className={styles.actions}>{cursor && <FanAction onClick={() => setCursor(null)}>{c.back}</FanAction>}{resource.state.data.nextCursor && <FanAction onClick={() => resource.state.status === "ready" && setCursor(resource.state.data.nextCursor)}>{c.more}</FanAction>}</div>
    </>}
    <ActionFeedback locale={locale} error={action.error} />
    <h2>{c.replays}</h2>{replay.state.status !== "ready" ? <ParticipationState locale={locale} status={replay.state.status} retry={replay.retry} /> : <form key={replay.state.data.replayRevision} className={styles.form} onSubmit={async event => { event.preventDefault(); if (replay.state.status !== "ready") return; const data = new FormData(event.currentTarget), url = String(data.get("url") ?? "").trim(), provider = String(data.get("provider")); if (url && !isRecordedReplayUrl(provider, url)) { action.setError("INVALID"); return; } if (await action.run(`/api/admin/live-events/${liveEventId}/replay`, "PUT", { expectedRevision: replay.state.data.replayRevision, replayProvider: url ? provider : null, replayUrl: url || null, replayPublished: data.get("published") === "on" }, parseReplay)) replay.retry(); }}><fieldset disabled={readOnly || action.busy}>
      <label>{c.source}<select name="provider" defaultValue={replay.state.data.replayProvider ?? "youtube"}>{["youtube", "instagram", "tiktok", "chzzk"].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>{c.replays} URL<input name="url" type="url" maxLength={2048} defaultValue={replay.state.data.replayUrl ?? ""} /></label><label><span>{c.published}</span><input name="published" type="checkbox" defaultChecked={replay.state.data.replayPublished} /></label><FanAction type="submit">{c.save}</FanAction>
      {replay.state.data.replayUrl && <a href={replay.state.data.replayUrl} target="_blank" rel="noopener noreferrer">{c.open}</a>}
    </fieldset></form>}
  </section>;
}
function Submission({ item, locale, readOnly, refresh }: { item: AdminLiveSubmission; locale: "ko" | "en"; readOnly: boolean; refresh: () => void }) {
  const c = participationCopy(locale), action = useParticipationAction(), [reason, setReason] = useState("");
  async function review(value: "select" | "unselect" | "hide") { if (await action.run(`/api/admin/live-submissions/${item.id}`, "PATCH", { expectedRevision: item.revision, action: value, reason: value === "hide" ? reason : null }, result => adminLiveSubmissionSchema.parse(result))) refresh(); }
  return <li className={styles.row}><strong>{item.nickname} · {c[item.kind]}</strong><p>{item.body ?? c.hidden}</p><span className={styles.badge}>{item.status === "submitted" ? c.pending : c[item.status]}</span><div className={styles.actions}>
    {item.status !== "hidden" && !item.deletedAt && <><FanAction disabled={readOnly || action.busy} onClick={() => void review(item.status === "selected" ? "unselect" : "select")}>{item.status === "selected" ? c.unselect : c.selected}</FanAction><label>{c.reason}<input value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label><FanAction disabled={readOnly || action.busy || !reason.trim()} onClick={() => void review("hide")}>{c.hide}</FanAction></>}
  </div><ActionFeedback locale={locale} error={action.error} /></li>;
}
