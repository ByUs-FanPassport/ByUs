import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseLiveAttendanceRepository } from "./live-attendance-repository";

const appUserId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const stampId = "33333333-3333-4333-8333-333333333333";
const rpcResult = {
  attendanceId: "44444444-4444-4444-8444-444444444444",
  liveEventId: "55555555-5555-4555-8555-555555555555",
  passportId: "66666666-6666-4666-8666-666666666666",
  activityId: "77777777-7777-4777-8777-777777777777",
  stampId,
  attendedAt: "2026-07-21T12:00:00.000Z",
  scorePoints: 3,
  stampMintStatus: "queued",
};

describe("SupabaseLiveAttendanceRepository", () => {
  it("calls only the atomic owner-scoped RPC and derives issuance identifiers server-side", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
    const repository = new SupabaseLiveAttendanceRepository({ rpc }, () => stampId);
    const result = await repository.attend({ appUserId, liveSlug: "kara-first-live", idempotencyKey, normalizedCode: "KARA2026", inputFormatValid: true });
    expect(rpc).toHaveBeenCalledWith("attend_owned_live_event", {
      p_app_user_id: appUserId,
      p_live_slug: "kara-first-live",
      p_idempotency_key: idempotencyKey,
      p_normalized_code: "KARA2026",
      p_input_format_valid: true,
      p_stamp_id: stampId,
      p_stamp_operation_key: `byus:stamp:v1:${stampId}`,
      p_stamp_issuance_id: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(result.attendance).toMatchObject({ id: rpcResult.attendanceId, scorePoints: 3 });
    expect(result).not.toHaveProperty("code");
  });

  it.each([
    ["G3_ATTENDANCE_LIVE_NOT_FOUND", "LIVE_NOT_FOUND"],
    ["G3_ATTENDANCE_PASSPORT_REQUIRED", "PASSPORT_REQUIRED"],
    ["G3_ATTENDANCE_CODE_INVALID", "ATTENDANCE_CODE_INVALID"],
    ["G3_ATTENDANCE_WALLET_NOT_READY", "WALLET_NOT_READY"],
    ["G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT", "IDEMPOTENCY_KEY_CONFLICT"],
  ])("maps %s without exposing database details", async (databaseCode, expected) => {
    const repository = new SupabaseLiveAttendanceRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: `${databaseCode}: private detail` } }),
    }, () => stampId);
    await expect(repository.attend({ appUserId, liveSlug: "kara-first-live", idempotencyKey, normalizedCode: "KARA2026", inputFormatValid: true }))
      .rejects.toMatchObject({ code: expected });
  });

  it("fails closed on malformed RPC output", async () => {
    const repository = new SupabaseLiveAttendanceRepository({ rpc: vi.fn().mockResolvedValue({ data: { code: "KARA2026" }, error: null }) }, () => stampId);
    await expect(repository.attend({ appUserId, liveSlug: "kara-first-live", idempotencyKey, normalizedCode: "KARA2026", inputFormatValid: true }))
      .rejects.toMatchObject({ code: "ATTENDANCE_INTEGRITY_ERROR" });
  });

  it("maps a committed category-only RPC failure envelope", async () => {
    const repository = new SupabaseLiveAttendanceRepository({
      rpc: vi.fn().mockResolvedValue({ data: { errorCode: "G3_ATTENDANCE_RATE_LIMITED" }, error: null }),
    }, () => stampId);
    await expect(repository.attend({ appUserId, liveSlug: "kara-first-live", idempotencyKey, normalizedCode: "", inputFormatValid: false }))
      .rejects.toMatchObject({ code: "ATTENDANCE_RATE_LIMITED" });
  });
});
