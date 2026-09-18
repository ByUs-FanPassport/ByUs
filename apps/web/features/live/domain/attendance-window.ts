import type { PublicLiveEvent } from './live-event';

export type AttendanceWindowState = 'unavailable' | 'upcoming' | 'open' | 'closed';
export function attendanceWindowState(live: Pick<PublicLiveEvent, 'attendanceConfigured' | 'attendanceWindow' | 'effectiveStatus'> | null, now: number): AttendanceWindowState {
  if (!live?.attendanceWindow || live.attendanceConfigured === false || live.effectiveStatus === 'cancelled') return 'unavailable';
  const opens = Date.parse(live.attendanceWindow.opensAt);
  const closes = Date.parse(live.attendanceWindow.closesAt);
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens >= closes) return 'unavailable';
  return now < opens ? 'upcoming' : now >= closes ? 'closed' : 'open';
}
