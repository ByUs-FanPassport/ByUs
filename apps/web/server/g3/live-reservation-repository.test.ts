import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseLiveReservationRepository } from "./live-reservation-repository";

const appUserId = "11111111-1111-4111-8111-111111111111";
const liveEventId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";
const stampId = "44444444-4444-4444-8444-444444444444";
const rpcResult = {
  reservationId: "55555555-5555-4555-8555-555555555555",
  liveEventId,
  passportId: "66666666-6666-4666-8666-666666666666",
  activityId: "77777777-7777-4777-8777-777777777777",
  stampId,
  reservedAt: "2026-07-21T12:00:00.000Z",
  scorePoints: 1,
  stampMintStatus: "queued",
};

describe("SupabaseLiveReservationRepository", () => {
  it("calls only the atomic owner-scoped RPC with server-derived issuance identifiers", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
    const repository = new SupabaseLiveReservationRepository({ rpc }, () => stampId);
    const result = await repository.reserve({ appUserId, liveEventId, idempotencyKey });

    expect(rpc).toHaveBeenCalledWith("reserve_owned_live_event", {
      p_app_user_id: appUserId,
      p_live_event_id: liveEventId,
      p_idempotency_key: idempotencyKey,
      p_stamp_id: stampId,
      p_stamp_operation_key: `byus:stamp:v1:${stampId}`,
      p_stamp_issuance_id: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(result).toEqual({ reservation: { id: rpcResult.reservationId, createdAt: rpcResult.reservedAt, stamp: { id: stampId, businessStatus: "issued", mintStatus: "queued" } } });
  });

  it("supports exact replay through the same RPC contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
    const repository = new SupabaseLiveReservationRepository({ rpc }, () => stampId);
    const first = await repository.reserve({ appUserId, liveEventId, idempotencyKey });
    const replay = await repository.reserve({ appUserId, liveEventId, idempotencyKey });
    expect(replay).toEqual(first);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["G3_LIVE_NOT_FOUND", "LIVE_NOT_FOUND"],
    ["G3_RESERVATION_UNAVAILABLE", "RESERVATION_UNAVAILABLE"],
    ["G3_RESERVATION_WINDOW_CLOSED", "RESERVATION_WINDOW_CLOSED"],
    ["G3_PASSPORT_REQUIRED", "PASSPORT_REQUIRED"],
    ["G3_WALLET_NOT_READY", "WALLET_NOT_READY"],
    ["G3_IDEMPOTENCY_KEY_CONFLICT", "IDEMPOTENCY_KEY_CONFLICT"],
  ])("maps %s without exposing database details", async (databaseCode, expected) => {
    const repository = new SupabaseLiveReservationRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: `${databaseCode}: secret detail` } }) }, () => stampId);
    await expect(repository.reserve({ appUserId, liveEventId, idempotencyKey })).rejects.toMatchObject({ code: expected });
  });
});
