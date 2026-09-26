"use client";
import { useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { mutationSchema, scheduleInputSchema, suggestionSchema, type ScheduleSuggestion } from "../domain/participation";
import { ActionFeedback, ParticipationState, ScheduleFields, scheduleFieldErrors, scheduleFormValues, useParticipationAction, type ScheduleFieldErrors } from "./participation-ui";
import styles from "./participation.module.css";

export function ScheduleSuggestionForm(props: { celebritySlug: string; locale: AppLocale }) {
  const auth = usePrivy();
  return <SuggestionForm key={`${auth.user?.id ?? "guest"}:${props.celebritySlug}:${props.locale}`} {...props} />;
}
function SuggestionForm({ celebritySlug, locale }: { celebritySlug: string; locale: AppLocale }) {
  const action = useParticipationAction(), c = participationCopy(locale);
  const [saved, setSaved] = useState<ScheduleSuggestion | null>(null);
  const [errors, setErrors] = useState<ScheduleFieldErrors>({}), formRef = useRef<HTMLFormElement>(null);
  if (!action.ready) return <ParticipationState locale={locale} status="loading" />;
  if (!action.authenticated) return <FanAction onClick={() => action.login()}>{c.login}</FanAction>;
  if (saved) return <div role="status"><p>{c.saved} {c.pending}</p><FanAction href={`/my/requests?tab=schedules&item=${saved.id}&locale=${locale}`}>{c.requests}</FanAction></div>;
  return <form ref={formRef} className={styles.form} onChange={() => Object.keys(errors).length && setErrors({})} onSubmit={async event => {
    event.preventDefault();
    const nextErrors = scheduleFieldErrors(event.currentTarget, locale);
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); const first = (["startsAt", "endsAt", "timeZone", "sourceUrl"] as const).find(name => nextErrors[name]); requestAnimationFrame(() => first && (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus()); return; }
    try {
      const input = { ...scheduleFormValues(event.currentTarget), celebritySlug, locale: toContentLocale(locale) };
      const body = scheduleInputSchema.parse({ ...input, idempotencyKey: action.idempotencyKey(input) });
      const result = await action.run("/api/schedule-suggestions", "POST", body, value => mutationSchema(suggestionSchema).parse(value));
      if (result) setSaved(result.item);
    } catch { action.setError("INVALID_REQUEST"); }
  }}><fieldset disabled={action.busy}><ScheduleFields locale={locale} errors={errors} /><FanAction type="submit" variant="primary" disabled={action.busy}>{action.busy ? c.loading : c.submit}</FanAction></fieldset><ActionFeedback locale={locale} error={action.error} /></form>;
}
