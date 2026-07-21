import { describe, expect, it } from "vitest";

import {
  createLiveReservationRequestSchema,
  projectAtomicReservationResult,
} from "./live-reservation";

const result = {
  reservationId: "11111111-1111-4111-8111-111111111111",
  liveEventId: "22222222-2222-4222-8222-222222222222",
  passportId: "33333333-3333-4333-8333-333333333333",
  activityId: "44444444-4444-4444-8444-444444444444",
  stampId: "55555555-5555-4555-8555-555555555555",
  reservedAt: "2026-07-21T12:00:00.000Z",
  scorePoints: 1,
  stampMintStatus: "queued",
};

describe("live reservation transport contract", () => {
  it("accepts only a UUID idempotency key", () => {
    expect(createLiveReservationRequestSchema.parse({ idempotencyKey: result.reservationId })).toEqual({ idempotencyKey: result.reservationId });
    expect(() => createLiveReservationRequestSchema.parse({ idempotencyKey: result.reservationId, appUserId: result.passportId })).toThrow();
    expect(() => createLiveReservationRequestSchema.parse({ idempotencyKey: "retry-1" })).toThrow();
  });

  it("projects the RPC result to the minimal UI summary", () => {
    const response = projectAtomicReservationResult(result);
    expect(response).toEqual({
      reservation: {
        id: result.reservationId,
        createdAt: result.reservedAt,
        stamp: { id: result.stampId, businessStatus: "issued", mintStatus: "queued" },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/passport|activity|points|liveEvent|wallet|payload/i);
  });

  it("rejects incomplete or semantically invalid atomic results", () => {
    expect(() => projectAtomicReservationResult({ ...result, scorePoints: 0 })).toThrow();
    expect(() => projectAtomicReservationResult({ ...result, internal: "leak" })).toThrow();
  });
});
