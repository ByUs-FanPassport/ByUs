"use client";
import { useState } from "react";
import { z } from "zod";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { localScheduleTime } from "../domain/schedule-time";
import { scheduleSchema } from "../domain/participation";
import { ActionFeedback, ParticipationPage, ParticipationState, useDeadlinePassed, useParticipationAction } from "./participation-ui";
import styles from "./participation.module.css";
const parse = (value: unknown) => scheduleSchema.parse(value);
export function ScheduleDetail(props: { id: string; locale: AppLocale }) { const auth = usePrivy(); return <Detail key={`${auth.user?.id ?? "guest"}:${props.id}:${props.locale}`} {...props} />; }
function Detail({ id, locale }: { id: string; locale: AppLocale }) {
  const c = participationCopy(locale), action = useParticipationAction(), [saved, setSaved] = useState(false);
  const resource = useFanpageResource(`/api/schedules/${id}?locale=${toContentLocale(locale)}`, parse);
  const started = useDeadlinePassed(resource.state.status === "ready" ? resource.state.data.startsAt : null);
  if (resource.state.status !== "ready") return <ParticipationPage locale={locale} title={c.schedules} path="/live"><ParticipationState locale={locale} status={resource.state.status} retry={resource.retry} /></ParticipationPage>;
  const item = resource.state.data;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: item.timeZone });
  const calendar = new URL("https://calendar.google.com/calendar/render");
  calendar.searchParams.set("action", "TEMPLATE"); calendar.searchParams.set("text", item.title); calendar.searchParams.set("dates", `${new Date(item.startsAt).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}/${new Date(item.endsAt).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`); calendar.searchParams.set("details", `${item.description}\n${item.officialSourceUrl}`); calendar.searchParams.set("location", item.location);
  return <ParticipationPage locale={locale} title={item.title} path="/live"><p>{item.celebrityName} · {c[item.kind]}{item.status === "cancelled" ? ` · ${c.cancelled}` : ""}</p><p>{item.description}</p>
    <dl className={styles.detail}><dt>{c.start}</dt><dd><time dateTime={item.startsAt}>{format.format(new Date(item.startsAt))}</time></dd><dt>{c.end}</dt><dd><time dateTime={item.endsAt}>{format.format(new Date(item.endsAt))}</time></dd><dt>{c.timezone}</dt><dd>{item.timeZone}</dd>{item.location && <><dt>{c.location}</dt><dd>{item.location}</dd></>}{item.participationInstructions && <><dt>{c.instructions}</dt><dd>{item.participationInstructions}</dd></>}</dl>
    <div className={styles.actions}><FanAction href={item.officialSourceUrl} external>{c.open}</FanAction>{item.status === "published" && <FanAction href={calendar.toString()} external>Google Calendar</FanAction>}
    {!action.authenticated ? <FanAction onClick={() => action.login()}>{c.login}</FanAction> : <FanAction disabled={action.busy || !action.ready || !item.subscribed && (item.status === "cancelled" || started)} onClick={async () => {
      const result = await action.run(`/api/schedules/${id}/subscription`, "PUT", { subscribed: !item.subscribed }, value => z.object({ scheduleId: z.string().uuid(), subscribed: z.boolean() }).parse(value));
      if (result) { setSaved(true); resource.retry(); }
    }}>{item.subscribed ? c.unsubscribe : c.subscribe}</FanAction>}</div><ActionFeedback locale={locale} error={action.error} saved={saved} />
    <FanAction href={`/live/calendar?month=${localScheduleTime(item.startsAt, "Asia/Seoul").slice(0, 7)}&celebrity=${item.celebritySlug}&locale=${locale}`}>{c.back}</FanAction>
  </ParticipationPage>;
}
