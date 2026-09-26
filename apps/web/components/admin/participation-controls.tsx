"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { z } from "zod";
import type { ReactNode } from "react";
import { useAdminSession } from "./use-admin-session";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { useNewsSource } from "@/features/fanpage/ui/use-news-source";
import { ParticipationState, ScheduleFields, scheduleFormValues } from "@/features/schedules/ui/participation-ui";
import { scheduleWriteSchema, type AdminSchedule, type ScheduleSuggestion, type ScheduleWrite } from "@/features/schedules/domain/participation";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import styles from "@/features/schedules/ui/participation.module.css";
export { styles };
export function ParticipationAdmin({ locale, title, description, children }: { locale: AdminLocale; title: string; description: string; children: (role: string) => ReactNode }) {
  const session = useAdminSession(), auth = usePrivy();
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  return <AdminOperationsShell locale={locale} adminRole={session.admin.role}><div className={styles.adminPanel} key={auth.user?.id}><header className={styles.adminHeading}><h1>{title}</h1><p>{description}</p></header>{children(session.admin.role)}</div></AdminOperationsShell>;
}
export function useAdminPage<T extends { id: string }>(url: string, parse: (value: unknown) => { items: T[]; nextCursor: string | null }) {
  const auth = usePrivy(), session = useByUsSession();
  return useNewsSource(url, parse, itemKey<T>, { key: `${auth.authenticated}:${auth.user?.id}:${session.generation}`, ready: auth.ready && auth.authenticated && session.ready,
    getToken: async () => { const token = await auth.getAccessToken(); if (!token) throw Error(); return token; } });
}
function itemKey<T extends { id: string }>(item: T) { return item.id; }
const refsSchema = z.object({ celebrities: z.array(z.object({ id: z.uuid(), slug: z.string(), status: z.enum(["draft", "published"]), nameKo: z.string(), nameEn: z.string() })) });
const parseRefs = (value: unknown) => refsSchema.parse(value).celebrities;
export function useParticipationCreators() { return useFanpageResource("/api/admin/lives", parseRefs); }
export type CreatorRefs = z.infer<typeof refsSchema>["celebrities"];
export function CreatorSelect({ locale, creators, value, locked = false, required = true }: { locale: AdminLocale; creators: CreatorRefs; value?: string; locked?: boolean; required?: boolean }) {
  const c = participationCopy(locale);
  return <label>{c.fanpageLabel}<select name="celebrityId" defaultValue={value ?? ""} required={required} disabled={locked}><option value="">—</option>{creators.map(item => <option key={item.id} value={item.id}>{locale === "ko" ? item.nameKo : item.nameEn} · {c[item.status]}</option>)}</select>{locked && <input type="hidden" name="celebrityId" value={value} />}</label>;
}
export function AdminScheduleForm({ locale, creators, initial, busy, onSave, onInvalid }: { locale: AdminLocale; creators: CreatorRefs; initial?: AdminSchedule | ScheduleSuggestion; busy: boolean; onSave: (payload: ScheduleWrite) => void; onInvalid: () => void }) {
  const c = participationCopy(locale), existing = initial && "officialSourceUrl" in initial ? initial : null, suggestion = initial && "sourceUrl" in initial ? initial : null;
  const celebrityId = existing?.celebrityId ?? creators.find(item => item.slug === suggestion?.celebritySlug)?.id;
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); try { const form = event.currentTarget, { sourceUrl, ...values } = scheduleFormValues(form), data = new FormData(form); onSave(scheduleWriteSchema.parse({ ...values, celebrityId: data.get("celebrityId"), title: { ko: values.title, en: String(data.get("titleEn")) }, description: { ko: values.description, en: String(data.get("descriptionEn") ?? "") }, officialSourceUrl: sourceUrl, status: suggestion ? "published" : data.get("status") })); } catch { onInvalid(); } }}>
    <fieldset disabled={busy}><CreatorSelect locale={locale} creators={creators} value={celebrityId} locked={Boolean(initial)} />
      <ScheduleFields locale={locale} initial={initial ? { kind: initial.kind, startsAt: initial.startsAt, endsAt: initial.endsAt, timeZone: initial.timeZone, location: initial.location, participationInstructions: initial.participationInstructions, title: existing?.title.ko ?? suggestion?.title, description: existing?.description.ko ?? suggestion?.description, sourceUrl: existing?.officialSourceUrl ?? suggestion?.sourceUrl } : undefined} />
      <label>{c.title} · English<input name="titleEn" required maxLength={160} defaultValue={existing?.title.en ?? (suggestion?.locale === "en" ? suggestion.title : "")} /></label>
      <label>{c.description} · English<textarea name="descriptionEn" rows={3} maxLength={4000} defaultValue={existing?.description.en ?? (suggestion?.locale === "en" ? suggestion.description : "")} /></label>
      {!suggestion && <label>{c.published}<select name="status" defaultValue={existing?.status ?? "draft"}>{(["draft", "published", "cancelled"] as const).filter(value => existing?.status !== "published" || value !== "draft").map(value => <option key={value} value={value}>{c[value]}</option>)}</select></label>}
      <FanAction type="submit">{suggestion ? c.approve : c.save}</FanAction>
    </fieldset>
  </form>;
}
export function AdminListState({ locale, resource }: { locale: AdminLocale; resource: { state: { status: "loading" | "error" | "ready"; data: unknown[]; nextCursor: string | null; moreLoading: boolean; moreError: boolean }; retry: () => void; loadMore: () => void } }) {
  const c = participationCopy(locale);
  return <>{resource.state.status !== "ready" ? <ParticipationState locale={locale} status={resource.state.status} retry={resource.retry} /> : !resource.state.data.length ? <p className={styles.adminEmpty} role="status">{c.empty}</p> : null}{resource.state.nextCursor && <FanAction disabled={resource.state.moreLoading} onClick={resource.loadMore}>{c.more}</FanAction>}{resource.state.moreError && <ParticipationState locale={locale} status="error" retry={resource.loadMore} />}</>;
}
