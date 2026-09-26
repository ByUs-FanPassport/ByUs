import type { LiveCalendarEvent, LiveCalendarMonth } from "@/features/live/domain/live-calendar";
import type { Schedule } from "./participation";
export type CalendarEntry = LiveCalendarEvent & { artistSlug?: string; schedule?: Schedule };
type Artist = { slug: string; name: string; image: string };
export function combinedCalendarDays(calendar: LiveCalendarMonth, schedules: readonly Schedule[], artists: readonly Artist[], liveArtists: ReadonlyMap<string, string>) {
  const byDate = new Map<string, CalendarEntry[]>();
  for (const schedule of schedules) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(schedule.startsAt));
    const artist = artists.find(item => item.slug === schedule.celebritySlug);
    const events = byDate.get(date) ?? [];
    events.push({ id: schedule.id, slug: `schedule-${schedule.id}`, startsAt: schedule.startsAt,
      effectiveStatus: schedule.status === "cancelled" ? "cancelled" : Date.parse(schedule.endsAt) <= Date.now() ? "ended" : "scheduled",
      title: schedule.title, celebrity: { name: schedule.celebrityName, image: artist?.image ?? "/images/avatars/star-pink.webp" },
      reservationState: null, hasBenefit: false, artistSlug: schedule.celebritySlug, schedule });
    byDate.set(date, events);
  }
  return calendar.days.map(day => ({ ...day, events: [
    ...day.events.map((event): CalendarEntry => ({ ...event, artistSlug: liveArtists.get(event.slug) })), ...(byDate.get(day.date) ?? []),
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id)) }));
}
