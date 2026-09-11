import { z } from "zod";

const count = z.number().int().nonnegative();
const comparison = z.object({ current: count, previous: count });
export const overviewDaysSchema = z.enum(["7", "30", "90"]);
export type OverviewDays = z.infer<typeof overviewDaysSchema>;
export const adminOverviewSchema = z.object({
  asOf: z.iso.datetime({ offset: true }),
  from: z.iso.datetime({ offset: true }),
  previousFrom: z.iso.datetime({ offset: true }),
  days: z.number().int().refine((v) => [7, 30, 90].includes(v)),
  members: z.object({ total: count, signups: comparison, week: comparison, month: comparison }),
  activity: z.object({ daily: count, monthly: count, measuredSince: z.iso.datetime({ offset: true }).nullable() }),
  trend: z.array(z.object({ date: z.iso.date(), signups: count })),
  usage: z.object({ passports: count, reactions: count, reservations: count, attendances: count, entries: count }),
  content: z.object({ creators: count, scheduled: count, live: count, ended: count, cancelled: count, drafts: count }),
  issues: z.object({ certifications: count, failedJobs: count, failedNotifications: count }),
  upcoming: z.array(z.object({
    id: z.uuid(), title: z.string(), titleEn: z.string(), creator: z.string(),
    startsAt: z.iso.datetime({ offset: true }), status: z.enum(["scheduled", "live"]), reservations: count,
  })),
});
export type AdminOverviewData = z.infer<typeof adminOverviewSchema>;
export type TrendPoint = AdminOverviewData["trend"][number];

export function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}

/** Group actual KST date buckets; weeks start Monday, no invented interpolation. */
export function groupSignups(points: TrendPoint[], interval: "day" | "week" | "month"): TrendPoint[] {
  const groups = new Map<string, number>();
  for (const point of points) {
    let date = point.date;
    if (interval === "month") date = `${date.slice(0, 7)}-01`;
    if (interval === "week") {
      const day = new Date(`${date}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      date = day.toISOString().slice(0, 10);
    }
    groups.set(date, (groups.get(date) ?? 0) + point.signups);
  }
  return [...groups].map(([date, signups]) => ({ date, signups }));
}
