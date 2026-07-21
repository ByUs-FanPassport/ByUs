import { z } from "zod";

import { liveReservationSummarySchema } from "./live-event";

export const createLiveReservationRequestSchema = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();

export const createLiveReservationResponseSchema = z.object({
  reservation: liveReservationSummarySchema,
});

export type CreateLiveReservationRequest = z.infer<
  typeof createLiveReservationRequestSchema
>;
export type CreateLiveReservationResponse = z.infer<
  typeof createLiveReservationResponseSchema
>;

const atomicReservationResultSchema = z
  .object({
    reservationId: z.string().uuid(),
    liveEventId: z.string().uuid(),
    passportId: z.string().uuid(),
    activityId: z.string().uuid(),
    stampId: z.string().uuid(),
    reservedAt: z.string().datetime({ offset: true }),
    scorePoints: z.literal(1),
    stampMintStatus: z.enum([
      "queued",
      "processing",
      "retryable",
      "permanent_failure",
      "minted",
    ]),
  })
  .strict();

export function projectAtomicReservationResult(value: unknown): CreateLiveReservationResponse {
  const result = atomicReservationResultSchema.parse(value);
  return createLiveReservationResponseSchema.parse({
    reservation: {
      id: result.reservationId,
      createdAt: result.reservedAt,
      stamp: {
        id: result.stampId,
        businessStatus: "issued",
        mintStatus: result.stampMintStatus,
      },
    },
  });
}
