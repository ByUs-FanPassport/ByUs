import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElinaAttendanceEntry } from './elina-attendance-entry';
import { elinaLiveSlug } from '../domain/elina-event';

const payload = {
  live: { id: 'c0960f8b-f01c-4308-97f8-3d13173922e8', slug: elinaLiveSlug, effectiveStatus: 'scheduled', startsAt: '2026-09-18T10:00:00Z', endsAt: '2026-09-18T11:00:00Z', reservationOpensAt: '2026-09-11T00:00:00Z', reservationClosesAt: '2026-09-18T10:00:00Z', title: 'Elina LIVE', description: 'Elina LIVE', productContext: 'LIVE', heroImage: { url: '/elina.jpg', alt: 'Elina' }, celebrity: { slug: 'elina', name: 'Elina', image: '/elina.jpg', fanCount: 0 }, brand: { slug: 'banksy', name: 'Banksy', logo: '/brand.jpg', websiteUrl: null }, watch: { available: false, provider: 'instagram', url: 'https://www.instagram.com/elina/' }, attendanceConfigured: true, attendanceWindow: { opensAt: '2026-09-18T10:00:00Z', closesAt: '2026-09-18T11:00:00Z' } },
  viewer: { authenticated: false, passport: 'missing', reservation: null }, primaryAction: 'sign_in_to_reserve',
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-18T10:30:00Z')); vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload))); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Elina attendance promotion', () => {
  it.each([['ko', '출석코드 입력하기'], ['en', 'Enter Fan Code']] as const)('takes %s visitors straight to the correct attendance section without requiring login first', async (locale, label) => {
    await act(async () => { render(<ElinaAttendanceEntry celebritySlug="elina" locale={locale} />); });
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/live/${elinaLiveSlug}?locale=${locale}#fan-code`);
    expect(fetch).toHaveBeenCalledWith(`/api/live-events/${elinaLiveSlug}?locale=${locale}`, expect.objectContaining({ cache: 'no-store' }));
    expect(screen.getByText(/20:00 KST/)).toBeVisible();
  });
  it('opens and closes at the time boundaries without a page reload', async () => {
    vi.setSystemTime(new Date('2026-09-18T09:59:59Z'));
    await act(async () => { render(<ElinaAttendanceEntry celebritySlug="elina" locale="ko" />); });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('link', { name: '출석코드 입력하기' })).toBeVisible();
    vi.setSystemTime(new Date('2026-09-18T10:59:59Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('hides stale promotion when the next public availability refresh fails', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(Response.json(payload)).mockResolvedValue(Response.json({}, { status: 503 }));
    await act(async () => { render(<ElinaAttendanceEntry celebritySlug="elina" locale="ko" />); });
    expect(screen.getByRole('link')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('does not fetch for other creators, and removes the banner on navigation away', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ElinaAttendanceEntry celebritySlug="kara" locale="ko" />); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { view.rerender(<ElinaAttendanceEntry celebritySlug="elina" locale="ko" />); });
    expect(screen.getByRole('link')).toBeVisible();
    view!.rerender(<ElinaAttendanceEntry celebritySlug="kara" locale="ko" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it.each(['cancelled', 'wrong-event', 'no-window'])('stays hidden for %s', async state => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...payload, live: { ...payload.live, ...(state === 'cancelled' ? { effectiveStatus: 'cancelled' } : state === 'wrong-event' ? { slug: 'another-event' } : { attendanceWindow: null }) } }));
    await act(async () => { render(<ElinaAttendanceEntry celebritySlug="elina" locale="ko" />); });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
