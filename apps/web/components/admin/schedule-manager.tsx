"use client";
import { useState } from "react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { pageSchema, adminScheduleSchema, mutationSchema, type AdminSchedule } from "@/features/schedules/domain/participation";
import { useParticipationAction, ActionFeedback, ParticipationState } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { ParticipationAdmin, useAdminPage, AdminScheduleForm, useParticipationCreators, AdminListState, styles } from "./participation-controls";
const parse = (value: unknown) => pageSchema(adminScheduleSchema).parse(value);
export function AuthorizedScheduleManager({ locale = "ko" }: { locale?: "ko" | "en" }) { return <ParticipationAdmin locale={locale} title={participationCopy(locale).schedules} description={locale === "ko" ? "최애의 공식 일정을 등록하고 공개 상태를 관리합니다." : "Create official artist schedules and manage their publication status."}>{role => <Manager locale={locale} role={role} />}</ParticipationAdmin>; }
function Manager({ locale, role }: { locale: "ko" | "en"; role: string }) {
  const c = participationCopy(locale), list = useAdminPage("/api/admin/schedules", parse), creators = useParticipationCreators(), action = useParticipationAction();
  const [selected, select] = useState<AdminSchedule | null>(null), [draft, setDraft] = useState(0), [saved, setSaved] = useState(false);
  return <><FanAction onClick={() => { select(null); setDraft(value => value + 1); setSaved(false); }} disabled={role === "viewer"}>{locale === "ko" ? "일정 추가" : "Add schedule"}</FanAction>
    <ul className={styles.list}>{list.state.data.map(item => <li className={styles.row} key={item.id}><span className={styles.badge}>{c[item.status]}</span><h3>{item.title[locale]}</h3><p>{item.celebritySlug} · {new Date(item.startsAt).toLocaleString(locale)}</p><FanAction onClick={() => select(item)}>{locale === "ko" ? "일정 열기" : "Open schedule"}</FanAction></li>)}</ul><AdminListState locale={locale} resource={list} />
    {creators.state.status !== "ready" ? <ParticipationState locale={locale} status={creators.state.status} retry={creators.retry} /> : <AdminScheduleForm key={`${selected?.id}:${selected?.revision}:${draft}`} locale={locale} creators={creators.state.data} initial={selected ?? undefined} busy={action.busy || role === "viewer" || selected?.status === "cancelled"} onInvalid={() => action.setError("INVALID")} onSave={async payload => {
      const input = { id: selected?.id ?? null, expectedRevision: selected?.revision ?? 0, payload };
      const result = await action.run("/api/admin/schedules", "POST", { ...input, idempotencyKey: action.idempotencyKey(input) }, value => mutationSchema(adminScheduleSchema).parse(value));
      if (result) { select(result.item); setSaved(true); list.retry(); }
    }} />}
    <ActionFeedback locale={locale} error={action.error} saved={saved} />
  </>;
}
