import { z } from "zod";

import { liveReservationSummarySchema } from "./live-event";
import { fanActivityCompletionSchema } from "./fan-activity-completion";

export const createLiveReservationRequestSchema = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();

export const createLiveReservationResponseSchema = z.object({
  reservation: liveReservationSummarySchema,
  completion: fanActivityCompletionSchema,
}).strict().superRefine((value, context) => {
  if (
    value.completion.earnedStamp.type !== "reservation"
    || value.completion.earnedStamp.id !== value.reservation.stamp.id
    || value.completion.earnedStamp.mintStatus !== value.reservation.stamp.mintStatus
    || value.completion.scoreDelta !== 1
  ) {
    context.addIssue({
      code: "custom",
      message: "reservation completion is inconsistent",
    });
  }
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
    completion: fanActivityCompletionSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.completion.passportId !== result.passportId
      || result.completion.earnedStamp.id !== result.stampId
      || result.completion.earnedStamp.type !== "reservation"
      || result.completion.earnedStamp.mintStatus !== result.stampMintStatus
      || result.completion.scoreDelta !== result.scorePoints
    ) {
      context.addIssue({
        code: "custom",
        message: "atomic reservation completion is inconsistent",
      });
    }
  });

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
    completion: result.completion,
  });
}
