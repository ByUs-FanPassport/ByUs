"use client";
import { useState } from "react";
import { z } from "zod";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { ContentActions, ContentTranslation } from "@/features/content-safety/ui/content-actions";
import { liveSubmissionsPageSchema, liveSubmissionInputSchema, mutationSchema, ownedLiveSubmissionSchema } from "@/features/schedules/domain/participation";
import { ActionFeedback, ParticipationState, useDeadlinePassed, useParticipationAction } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import styles from "@/features/schedules/ui/participation.module.css";
const parse = (value: unknown) => liveSubmissionsPageSchema.parse(value);
export function LiveFanSubmissions(props: { slug: string; celebritySlug: string; locale: AppLocale }) {
  const auth = usePrivy();
  return <Submissions key={`${auth.user?.id ?? "guest"}:${props.slug}:${props.locale}`} {...props} />;
}
function Submissions({ slug, celebritySlug, locale }: { slug: string; celebritySlug: string; locale: AppLocale }) {
  const c = participationCopy(locale), action = useParticipationAction();
  const [kind, setKind] = useState<"question" | "cheer">("question"), [body, setBody] = useState("");
  const [cursor, setCursor] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const url = `/api/live-events/${slug}/submissions?locale=${toContentLocale(locale)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const resource = useFanpageResource(url, parse);
  const data = resource.state.status === "ready" ? resource.state.data : null;
  const closesAt = data?.settings.closesAt;
  const closed = useDeadlinePassed(closesAt);
  const open = data?.settings.accepting && !closed;
  const existing = data?.mine.some(item => item.kind === kind);
  return <section className={styles.panel} aria-labelledby={`live-submissions-${slug}`}><h2 id={`live-submissions-${slug}`}>{c.question} · {c.cheer}</h2>
    {!data ? <ParticipationState locale={locale} status={resource.state.status === "error" ? "error" : "loading"} retry={resource.retry} /> : <>
      {closesAt && <p className={styles.meta}>{c.deadline}: <time dateTime={closesAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(closesAt))} (KST)</time></p>}
      {!open ? <p>{c.closed}</p> : data.access === "members_required" ? <><p>{c.members}</p><FanAction href={`/c/${celebritySlug}/verify?locale=${locale}`}>{c.verify}</FanAction></> : !action.authenticated ? <FanAction onClick={() => action.login()}>{c.login}</FanAction> : <form className={styles.form} onSubmit={async event => {
        event.preventDefault();
        try {
          const input = { kind, body: body.trim() };
          const result = await action.run(`/api/live-events/${slug}/submissions`, "POST", liveSubmissionInputSchema.parse({ ...input, idempotencyKey: action.idempotencyKey(input) }), value => mutationSchema(ownedLiveSubmissionSchema).parse(value));
          if (result) { setBody(""); setSaved(true); resource.retry(); }
        } catch { action.setError("INVALID_REQUEST"); }
      }}><fieldset disabled={action.busy || !action.ready}><label>{c.submit}<select value={kind} onChange={event => setKind(event.target.value as "question" | "cheer")}><option value="question">{c.question}</option><option value="cheer">{c.cheer}</option></select></label>
        {existing ? <p>{c.mine} · {c.pending}</p> : <><label>{c[kind]}<textarea rows={3} required maxLength={1000} value={body} onChange={event => setBody(event.target.value)} /></label><FanAction type="submit" disabled={action.busy || !body.trim()}>{c.submit}</FanAction></>}
      </fieldset></form>}
      <ActionFeedback locale={locale} error={action.error} saved={saved} />
      {data.mine.length > 0 && <><h3>{c.mine}</h3><ul className={styles.list}>{data.mine.map(item => <li key={item.id} className={styles.row}><span className={styles.badge}>{item.status === "selected" ? c.selected : item.status === "hidden" ? c.hidden : c.pending}</span>{item.body && <p>{item.body}</p>}<FanAction disabled={action.busy} onClick={async () => {
        const result = await action.run(`/api/live-submissions/${item.id}`, "DELETE", null, value => z.object({ id: z.string().uuid(), deleted: z.literal(true), replayed: z.boolean() }).parse(value));
        if (result) { setSaved(false); resource.retry(); }
      }}>{c.delete}</FanAction></li>)}</ul></>}
      <h3>{c.selected}</h3>{data.items.length ? <ul className={styles.list}>{data.items.map(item => <li key={item.id} className={styles.row}><strong>{item.nickname}</strong><span className={styles.badge}>{c[item.kind]}</span>
        <ContentTranslation targetType="live_submission" targetId={item.id} sourceRevision={item.revision} locale={locale}><p>{item.body}</p></ContentTranslation>
        <ContentActions targetType="live_submission" targetId={item.id} locale={locale} canBlock={!item.isOwner} onChanged={resource.retry} />
      </li>)}</ul> : <p>{c.empty}</p>}
      <div className={styles.actions}>{cursor && <FanAction onClick={() => setCursor(null)}>{c.firstPage}</FanAction>}{data.nextCursor && <FanAction onClick={() => setCursor(data.nextCursor)}>{c.more}</FanAction>}</div>
    </>}
  </section>;
}
