"use client";
import { useState } from "react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { pageSchema, fanpageRequestSchema, mutationSchema, type FanpageRequest } from "@/features/schedules/domain/participation";
import { useParticipationAction, ActionFeedback, ParticipationState } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { ParticipationAdmin, useAdminPage, CreatorSelect, useParticipationCreators, AdminListState, styles, type CreatorRefs } from "./participation-controls";
const parse = (value: unknown) => pageSchema(fanpageRequestSchema).parse(value);
export function AuthorizedFanpageRequestManager({ locale = "ko" }: { locale?: "ko" | "en" }) { return <ParticipationAdmin locale={locale} title={participationCopy(locale).fanpage}>{role => <Manager locale={locale} role={role} />}</ParticipationAdmin>; }
function Manager({ locale, role }: { locale: "ko" | "en"; role: string }) {
  const c = participationCopy(locale), [status, setStatus] = useState("pending"), list = useAdminPage(`/api/admin/fanpage-requests?status=${status}&locale=${locale}`, parse), creators = useParticipationCreators();
  const creatorItems = creators.state.status === "ready" ? creators.state.data : [];
  return <><div className={styles.tabs}>{(["pending", "approved", "rejected"] as const).map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{c[value]}</button>)}</div><FanAction href={`/admin/celebrities?lang=${locale}`}>{c.fanpage} +</FanAction>
    {creators.state.status !== "ready" ? <ParticipationState locale={locale} status={creators.state.status} retry={creators.retry} /> : <ul className={styles.list}>{list.state.data.map(item => <Review key={`${item.id}:${item.revision}`} item={item} locale={locale} role={role} creators={creatorItems} refresh={list.retry} />)}</ul>}<AdminListState locale={locale} resource={list} /></>;
}
function Review({ item, locale, role, creators, refresh }: { item: FanpageRequest; locale: "ko" | "en"; role: string; creators: CreatorRefs; refresh: () => void }) {
  const c = participationCopy(locale), action = useParticipationAction(), [decision, setDecision] = useState<"approve" | "reject">("approve");
  return <li className={styles.row}><span className={styles.badge}>{c[item.status]}</span><h3>{item.name}</h3><a href={item.officialSocialUrl} target="_blank" rel="noopener noreferrer">{item.officialSocialUrl}</a><p>{item.note}</p>{item.reviewReason && <p>{c.reason}: {item.reviewReason}</p>}{item.artist && <FanAction href={item.artist.href}>{item.artist.name}</FanAction>}
    {item.status === "pending" && <form className={styles.form} onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget), approve = decision === "approve"; const result = await action.run(`/api/admin/fanpage-requests/${item.id}`, "PATCH", { expectedRevision: item.revision, decision, celebrityId: approve ? data.get("celebrityId") : null, reason: String(data.get("reason") ?? "").trim() || null, locale }, value => mutationSchema(fanpageRequestSchema).parse(value)); if (result) refresh(); }}><fieldset disabled={action.busy || role === "viewer"}><label>{c.reviewDecision}<select name="decision" value={decision} onChange={event => setDecision(event.target.value as "approve" | "reject")}><option value="approve">{c.approve}</option><option value="reject">{c.reject}</option></select></label><CreatorSelect locale={locale} creators={creators} required={decision === "approve"} /><label>{c.reason}<textarea name="reason" required={decision === "reject"} maxLength={2000} /></label><FanAction type="submit">{c.save}</FanAction></fieldset></form>}
    <ActionFeedback locale={locale} error={action.error} />{action.error.includes("CONFLICT") && <FanAction onClick={refresh}>{c.refreshLatest}</FanAction>}</li>;
}
