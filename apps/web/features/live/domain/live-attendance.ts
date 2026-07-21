import { z } from "zod";

const fanCodeSchema = z.string().min(1).max(64);

export const createLiveAttendanceRequestSchema = z.object({ code: fanCodeSchema }).strict();

export function normalizeFanCode(value: string): string {
  return value.replace(/[\t\n\f\r ]/g, "").toUpperCase();
}

export function isNormalizedFanCodeValid(value: string): boolean {
  return /^[A-Z0-9]{4,32}$/.test(value);
}

const mintStatusSchema = z.enum([
  "queued",
  "processing",
  "retryable",
  "permanent_failure",
  "minted",
]);

const atomicAttendanceResultSchema = z.object({
  attendanceId: z.string().uuid(),
  liveEventId: z.string().uuid(),
  passportId: z.string().uuid(),
  activityId: z.string().uuid(),
  stampId: z.string().uuid(),
  attendedAt: z.string().datetime({ offset: true }),
  scorePoints: z.literal(3),
  stampMintStatus: mintStatusSchema,
}).strict();

export const createLiveAttendanceResponseSchema = z.object({
  attendance: z.object({
    id: z.string().uuid(),
    liveEventId: z.string().uuid(),
    attendedAt: z.string().datetime({ offset: true }),
    scorePoints: z.literal(3),
    stamp: z.object({
      id: z.string().uuid(),
      businessStatus: z.literal("issued"),
      mintStatus: mintStatusSchema,
    }).strict(),
  }).strict(),
}).strict();

export type CreateLiveAttendanceResponse = z.infer<typeof createLiveAttendanceResponseSchema>;

export function projectAtomicAttendanceResult(value: unknown): CreateLiveAttendanceResponse {
  const result = atomicAttendanceResultSchema.parse(value);
  return createLiveAttendanceResponseSchema.parse({
    attendance: {
      id: result.attendanceId,
      liveEventId: result.liveEventId,
      attendedAt: result.attendedAt,
      scorePoints: result.scorePoints,
      stamp: {
        id: result.stampId,
        businessStatus: "issued",
        mintStatus: result.stampMintStatus,
      },
    },
  });
}
