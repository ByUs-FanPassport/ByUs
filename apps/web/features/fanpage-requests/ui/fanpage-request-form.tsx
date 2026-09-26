"use client";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { usePrivy } from "@privy-io/react-auth";
import { FanAction } from "@/components/fan-ui/fan-action";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { artistLinkSchema, fanpageCheckSchema, fanpageInputSchema, fanpageRequestSchema, mutationSchema, type FanpageRequest } from "@/features/schedules/domain/participation";
import { ActionFeedback, ParticipationState, useParticipationAction } from "@/features/schedules/ui/participation-ui";
import styles from "@/features/schedules/ui/participation.module.css";

export function FanpageRequestForm(props: { locale: AppLocale; initialName?: string }) {
  const auth = usePrivy();
  return <RequestForm key={`${auth.user?.id ?? "guest"}:${props.locale}`} {...props} />;
}
function RequestForm({ locale, initialName = "" }: { locale: AppLocale; initialName?: string }) {
  const action = useParticipationAction(), c = participationCopy(locale);
  const form = useRef<HTMLFormElement>(null), socialHelpId = useId();
  const [matches, setMatches] = useState<z.infer<typeof artistLinkSchema>[] | null>(null);
  const [saved, setSaved] = useState<FanpageRequest | null>(null);
  async function check() {
    try {
      const values = Object.fromEntries(new FormData(form.current!));
      const input = fanpageCheckSchema.parse({ name: values.name, officialSocialUrl: values.officialSocialUrl, locale: toContentLocale(locale) });
      const result = await action.run("/api/fanpage-requests/check", "POST", input, value => z.object({ artists: z.array(artistLinkSchema) }).parse(value), false);
      if (result) setMatches(result.artists);
      return result?.artists ?? null;
    } catch { action.setError("INVALID_REQUEST"); return null; }
  }
  if (!action.ready) return <ParticipationState locale={locale} status="loading" />;
  if (!action.authenticated) return <FanAction onClick={() => action.login()}>{c.login}</FanAction>;
  if (saved) return <div role="status"><p>{c.saved} {c.pending}</p><FanAction href={`/my/requests?tab=fanpages&item=${saved.id}&locale=${locale}`}>{c.requests}</FanAction></div>;
  return <form ref={form} className={styles.form} onChange={() => setMatches(null)} onSubmit={async event => {
    event.preventDefault();
    const current = matches ?? await check();
    if (current === null || current.length) return;
    try {
      const input = { ...Object.fromEntries(new FormData(form.current!)), locale: toContentLocale(locale) };
      const body = fanpageInputSchema.parse({ ...input, idempotencyKey: action.idempotencyKey(input) });
      const result = await action.run("/api/fanpage-requests", "POST", body, value => mutationSchema(fanpageRequestSchema).parse(value));
      if (result) setSaved(result.item);
    } catch { action.setError("INVALID_REQUEST"); }
  }}><fieldset disabled={action.busy}>
    <label>{c.name}<input name="name" required maxLength={120} defaultValue={initialName} /></label>
    <label>{c.social}<input name="officialSocialUrl" type="url" required maxLength={2048} aria-describedby={socialHelpId} /></label>
    <p id={socialHelpId} className={styles.meta}>{c.socialProfileHelp}</p>
    <FanAction onClick={() => void check()} disabled={action.busy}>{c.check}</FanAction>
    {matches && <div role="status">{matches.length ? matches.map(artist => <p key={artist.slug}><FanAction href={`${artist.href}?locale=${locale}`}>{artist.name} · {c.view}</FanAction></p>) : <p>{c.empty}</p>}</div>}
    <label>{c.note}<textarea name="note" rows={3} maxLength={2000} /></label>
    <FanAction type="submit" variant="primary" disabled={action.busy || Boolean(matches?.length)}>{action.busy ? c.loading : c.submit}</FanAction>
  </fieldset><ActionFeedback locale={locale} error={action.error} /></form>;
}
