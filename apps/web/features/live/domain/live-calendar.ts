import { z } from "zod";

import { effectiveLiveStatusSchema, safeAssetUrlSchema } from "./live-event";

const calendarMonthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export const liveCalendarMonthValueSchema = z
  .string()
  .regex(calendarMonthPattern)
  .refine((value) => Number(value.slice(0, 4)) >= 1_000, "calendar month is out of range");

export const liveCalendarEventSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    startsAt: z.iso.datetime({ offset: true }),
    effectiveStatus: effectiveLiveStatusSchema,
    title: z.string().trim().min(1).max(160),
    celebrity: z
      .object({
        name: z.string().trim().min(1).max(120),
        image: safeAssetUrlSchema,
      })
      .strict(),
    reservationState: z.enum(["reserved", "not_reserved"]).nullable(),
    hasBenefit: z.boolean().nullable(),
  })
  .strict();

export const liveCalendarDaySchema = z
  .object({
    date: z.string().regex(calendarDatePattern),
    events: z.array(liveCalendarEventSchema),
  })
  .strict();

export const liveCalendarMonthSchema = z
  .object({
    month: liveCalendarMonthValueSchema,
    timeZone: z.literal("Asia/Seoul"),
    days: z.array(liveCalendarDaySchema),
  })
  .strict();

export type LiveCalendarEvent = z.infer<typeof liveCalendarEventSchema>;
export type LiveCalendarDay = z.infer<typeof liveCalendarDaySchema>;
export type LiveCalendarMonth = z.infer<typeof liveCalendarMonthSchema>;

function parseMonth(month: string): { year: number; monthIndex: number } {
  const value = liveCalendarMonthValueSchema.parse(month);
  return {
    year: Number(value.slice(0, 4)),
    monthIndex: Number(value.slice(5, 7)) - 1,
  };
}

export function resolveLiveCalendarMonth(value: unknown, fallback: string): string {
  const parsed = liveCalendarMonthValueSchema.safeParse(value);
  return parsed.success ? parsed.data : liveCalendarMonthValueSchema.parse(fallback);
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function getLiveCalendarUtcBounds(month: string): {
  startsAt: string;
  endsAt: string;
} {
  const { year, monthIndex } = parseMonth(month);
  const startsAt = new Date(
    Date.UTC(year, monthIndex, 1) - KST_OFFSET_MILLISECONDS,
  ).toISOString();
  const endsAt = new Date(
    Date.UTC(year, monthIndex + 1, 1) - KST_OFFSET_MILLISECONDS,
  ).toISOString();
  return { startsAt, endsAt };
}

function getKstDate(instant: string): string {
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds)) throw new Error("invalid LIVE calendar instant");
  return new Date(milliseconds + KST_OFFSET_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

export function buildLiveCalendarMonth(input: {
  month: string;
  events: readonly unknown[];
}): LiveCalendarMonth {
  const { year, monthIndex } = parseMonth(input.month);
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const days: LiveCalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => ({
    date: toIsoDate(year, monthIndex, index + 1),
    events: [],
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));

  for (const rawEvent of input.events) {
    const event = liveCalendarEventSchema.parse(rawEvent);
    byDate.get(getKstDate(event.startsAt))?.events.push(event);
  }

  for (const day of days) {
    day.events.sort((left, right) => {
      const byInstant = Date.parse(left.startsAt) - Date.parse(right.startsAt);
      return byInstant || left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id);
    });
  }

  return liveCalendarMonthSchema.parse({
    month: input.month,
    timeZone: "Asia/Seoul",
    days,
  });
}
