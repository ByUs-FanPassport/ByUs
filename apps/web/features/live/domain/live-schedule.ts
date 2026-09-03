import { z } from "zod";

const KST_OFFSET_HOURS = 9;
const dateTimeLocal = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const instant = z.string().datetime({ offset: true });

export function toKstDateTimeLocal(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError("Invalid instant");
  return new Date(timestamp + KST_OFFSET_HOURS * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 16);
}

export function kstDateTimeLocalToInstant(value: string): string {
  const match = dateTimeLocal.exec(value);
  if (!match) throw new RangeError("Invalid KST date-time");

  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - KST_OFFSET_HOURS,
    Number(minute),
  );
  const result = new Date(timestamp).toISOString();
  if (toKstDateTimeLocal(result) !== value) throw new RangeError("Invalid KST date-time");
  return result;
}

export function isLiveWindowOrdered(input: {
  reservationOpensAt: string;
  reservationClosesAt: string;
  startsAt: string;
  endsAt: string;
}): boolean {
  const reservationOpen = Date.parse(input.reservationOpensAt);
  const reservationClose = Date.parse(input.reservationClosesAt);
  const startsAt = Date.parse(input.startsAt);
  const endsAt = Date.parse(input.endsAt);
  return reservationOpen < reservationClose
    && reservationClose <= startsAt
    && startsAt < endsAt;
}

export const liveScheduleRevisionSchema = z
  .object({
    liveEventId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000),
    reservationOpensAt: instant,
    reservationClosesAt: instant,
    startsAt: instant,
    endsAt: instant,
    attendanceValidFrom: instant,
    attendanceValidUntil: instant,
  })
  .strict()
  .superRefine((value, ctx) => {
    const attendanceFrom = Date.parse(value.attendanceValidFrom);
    const attendanceUntil = Date.parse(value.attendanceValidUntil);

    if (!isLiveWindowOrdered(value)) {
      ctx.addIssue({ code: "custom", path: ["startsAt"], message: "INVALID_SCHEDULE" });
    }
    if (!(attendanceFrom < attendanceUntil)) {
      ctx.addIssue({ code: "custom", path: ["attendanceValidUntil"], message: "INVALID_ATTENDANCE_WINDOW" });
    }
  });

export type LiveScheduleRevision = z.infer<typeof liveScheduleRevisionSchema>;
