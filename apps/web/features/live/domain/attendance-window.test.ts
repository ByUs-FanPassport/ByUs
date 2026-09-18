import { describe, expect, it } from 'vitest';
import { attendanceWindowState } from './attendance-window';
const live = { effectiveStatus: 'live', attendanceConfigured: true, attendanceWindow: { opensAt: '2026-09-18T10:00:00Z', closesAt: '2026-09-18T11:00:00Z' } } as const;
describe('attendance reception window', () => {
  it.each([['2026-09-18T09:59:59.999Z', 'upcoming'], ['2026-09-18T10:00:00Z', 'open'], ['2026-09-18T10:59:59.999Z', 'open'], ['2026-09-18T11:00:00Z', 'closed']])('uses inclusive opening and exclusive closing at %s', (at, expected) => {
    expect(attendanceWindowState(live, Date.parse(at))).toBe(expected);
  });
  it('never promotes cancelled, unconfigured, unknown, or malformed windows', () => {
    for (const candidate of [null, { ...live, effectiveStatus: 'cancelled' as const }, { ...live, attendanceConfigured: false }, { ...live, attendanceWindow: null }, { ...live, attendanceWindow: { opensAt: 'invalid', closesAt: live.attendanceWindow.closesAt } }, { ...live, attendanceWindow: { opensAt: live.attendanceWindow.closesAt, closesAt: live.attendanceWindow.opensAt } }]) {
      expect(attendanceWindowState(candidate, Date.parse('2026-09-18T10:30:00Z'))).toBe('unavailable');
    }
  });
});
