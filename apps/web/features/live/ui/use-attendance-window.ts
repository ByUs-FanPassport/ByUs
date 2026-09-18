'use client';

import { useEffect, useState } from 'react';
import type { PublicLiveEvent } from '../domain/live-event';
import { attendanceWindowState } from '../domain/attendance-window';

export function useAttendanceWindow(live: PublicLiveEvent | null) {
  const [now, setNow] = useState<number | null>(null);
  const opensAt = live?.attendanceWindow?.opensAt;
  const closesAt = live?.attendanceWindow?.closesAt;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const next = [opensAt, closesAt].map(value => value ? Date.parse(value) : NaN).filter(value => value > current).sort((a, b) => a - b)[0];
      if (next) timer = setTimeout(update, Math.min(next - current, 2_147_483_647));
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [opensAt, closesAt]);
  return now === null ? 'unavailable' : attendanceWindowState(live, now);
}
