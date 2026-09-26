"use client";
import { useState } from "react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { pageSchema, suggestionSchema, mutationSchema, type ScheduleSuggestion } from "@/features/schedules/domain/participation";
import { useParticipationAction, ActionFeedback, ParticipationState } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { ParticipationAdmin, useAdminPage, AdminScheduleForm, useParticipationCreators, AdminListState, styles } from "./participation-controls";
const parse = (value: unknown) => pageSchema(suggestionSchema).parse(value);
export function AuthorizedScheduleSuggestionManager({ locale = "ko" }: { locale?: "ko" | "en" }) { return <ParticipationAdmin locale={locale} title={participationCopy(locale).suggest} description={locale === "ko" ? "팬이 제안한 일정과 공식 출처를 확인하고 승인하거나 반려합니다." : "Review fan suggestions and official sources, then approve or decline them."}>{role => <Manager locale={locale} role={role} />}</ParticipationAdmin>; }
function Manager({ locale, role }: { locale: "ko" | "en"; role: string }) {
  const c = participationCopy(locale), [status, setStatus] = useState("pending"), list = useAdminPage(`/api/admin/schedule-suggestions?status=${status}`, parse), creators = useParticipationCreators();
  const creatorItems = creators.state.status === "ready" ? creators.state.data : [];
  return <><div className={styles.tabs}>{(["pending", "approved", "rejected"] as const).map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{c[value]}</button>)}</div>
    {creators.state.status !== "ready" ? <ParticipationState locale={locale} status={creators.state.status} retry={creators.retry} /> : <ul className={styles.list}>{list.state.data.map(item => <Review key={`${item.id}:${item.revision}`} item={item} locale={locale} role={role} creators={creatorItems} refresh={list.retry} />)}</ul>}<AdminListState locale={locale} resource={list} /></>;
}
function Review({ item, locale, role, creators, refresh }: { item: ScheduleSuggestion; locale: "ko" | "en"; role: string; creators: Parameters<typeof AdminScheduleForm>[0]["creators"]; refresh: () => void }) {
  const c = participationCopy(locale), action = useParticipationAction();
  async function review(decision: "approve" | "reject", reason: string | null, schedule: unknown) { if (await action.run(`/api/admin/schedule-suggestions/${item.id}`, "PATCH", { expectedRevision: item.revision, decision, reason, schedule }, value => mutationSchema(suggestionSchema).parse(value))) refresh(); }
  return <li className={styles.row}><span className={styles.badge}>{c[item.status]}</span><h3>{item.title}</h3><p>{item.description}</p><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{c.source}</a>{item.reviewReason && <p>{c.reason}: {item.reviewReason}</p>}{item.scheduleHref && <FanAction href={item.scheduleHref}>{c.open}</FanAction>}
    {item.status === "pending" && <><details><summary>{c.approve}</summary><AdminScheduleForm locale={locale} creators={creators} initial={item} busy={action.busy || role === "viewer"} onInvalid={() => action.setError("INVALID")} onSave={schedule => void review("approve", null, schedule)} /></details><form className={styles.form} onSubmit={event => { event.preventDefault(); void review("reject", String(new FormData(event.currentTarget).get("reason")), null); }}><fieldset disabled={role === "viewer" || action.busy}><label>{c.reason}<textarea name="reason" required maxLength={2000} /></label><FanAction type="submit">{c.reject}</FanAction></fieldset></form></>}
    <ActionFeedback locale={locale} error={action.error} />{action.error.includes("CONFLICT") && <FanAction onClick={refresh}>{c.refreshLatest}</FanAction>}</li>;
}
