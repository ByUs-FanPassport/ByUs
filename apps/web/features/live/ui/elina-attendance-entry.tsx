'use client';

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { useEffect, useState } from 'react';
import { elinaLiveSlug } from '../domain/elina-event';
import { liveEventResponseSchema, type LiveLocale, type PublicLiveEvent } from '../domain/live-event';
import { AttendanceSpotlight } from './attendance-spotlight';
import { useAttendanceWindow } from './use-attendance-window';

export function ElinaAttendanceEntry({ celebritySlug, locale }: { celebritySlug: string; locale: AppLocale }) {
  const key = `${celebritySlug}:${locale}`;
  const [snapshot, setSnapshot] = useState<{ key: string; live: PublicLiveEvent } | null>(null);
  const live = snapshot?.key === key ? snapshot.live : null;
  const phase = useAttendanceWindow(live);
  useEffect(() => {
    if (celebritySlug !== 'elina') return;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch(`/api/live-events/${elinaLiveSlug}?locale=${toContentLocale(locale)}`, { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Live availability unavailable');
        const { live: received } = liveEventResponseSchema.parse(await response.json());
        if (request.signal.aborted) return;
        setSnapshot(received.slug === elinaLiveSlug && received.celebrity.slug === 'elina' ? { key, live: received } : null);
      } catch {
        if (!request.signal.aborted) setSnapshot(null);
      }
    };
    void refresh();
    const onVisible = () => { void refresh(); };
    const timer = setInterval(onVisible, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [celebritySlug, locale, key]);
  if (celebritySlug !== 'elina' || phase !== 'open' || !live?.attendanceWindow) return null;
  return <AttendanceSpotlight locale={locale} closesAt={live.attendanceWindow.closesAt} href={`/live/${elinaLiveSlug}?locale=${locale}#fan-code`} />;
}
