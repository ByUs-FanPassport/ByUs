import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { LiveAttendanceRepositoryError } from "./live-attendance-repository";
import { createPostLiveAttendanceHandler } from "./live-attendance-route";

const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const result = {
  attendance: {
    id: "22222222-2222-4222-8222-222222222222",
    liveEventId: "33333333-3333-4333-8333-333333333333",
    attendedAt: "2026-07-21T12:00:00.000Z",
    scorePoints: 3 as const,
    stamp: { id: "44444444-4444-4444-8444-444444444444", businessStatus: "issued" as const, mintStatus: "queued" as const },
  },
};

function request(body: unknown = { code: " KARA 2026 " }, key = idempotencyKey) {
  return new Request("https://byus.example/api/live-events/kara-first-live/attendance", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

describe("POST live attendance handler", () => {
  it("derives the canonical owner and passes only the normalized code to the repository", async () => {
    const attend = vi.fn().mockResolvedValue(result);
    const run = createPostLiveAttendanceHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { attend } });
    const response = await run(request(), { slug: "kara-first-live" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(attend).toHaveBeenCalledWith({ appUserId: "owner-id", liveSlug: "kara-first-live", idempotencyKey, normalizedCode: "KARA2026", inputFormatValid: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    [{ code: "KARA2026", appUserId: "attacker" }, idempotencyKey],
    [{ code: "KARA2026", idempotencyKey }, idempotencyKey],
    [{ code: "KARA2026" }, "not-a-uuid"],
  ])("rejects a non-canonical request", async (body, key) => {
    const attend = vi.fn();
    const run = createPostLiveAttendanceHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { attend } });
    const response = await run(request(body, key), { slug: "kara-first-live" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(attend).not.toHaveBeenCalled();
  });

  it("classifies a malformed code without forwarding its raw value", async () => {
    const attend = vi.fn().mockRejectedValue(new LiveAttendanceRepositoryError("ATTENDANCE_CODE_INVALID"));
    const run = createPostLiveAttendanceHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { attend } });
    const response = await run(request({ code: "raw-secret-value!" }), { slug: "kara-first-live" });
    expect(response.status).toBe(422);
    expect(attend).toHaveBeenCalledWith({
      appUserId: "owner-id",
      liveSlug: "kara-first-live",
      idempotencyKey,
      normalizedCode: "",
      inputFormatValid: false,
    });
  });

  it("requires canonical authentication", async () => {
    const run = createPostLiveAttendanceHandler({ authorize: async () => { throw new AuthError("AUTHENTICATION_REQUIRED", 401, "invalid"); }, repository: { attend: vi.fn() } });
    const response = await run(request(), { slug: "kara-first-live" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTHENTICATION_REQUIRED" } });
  });

  it("authenticates before reading a bounded request body", async () => {
    const authorize = vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "invalid"));
    const run = createPostLiveAttendanceHandler({ authorize, repository: { attend: vi.fn() } });
    const oversized = request({ code: "A".repeat(300) });
    const response = await run(oversized, { slug: "kara-first-live" });
    expect(response.status).toBe(401);
    expect(authorize).toHaveBeenCalledOnce();
  });

  it.each([
    ["LIVE_NOT_FOUND", 404, "LIVE_NOT_FOUND"],
    ["PASSPORT_REQUIRED", 403, "PASSPORT_REQUIRED"],
    ["ATTENDANCE_CODE_INVALID", 422, "ATTENDANCE_CODE_INVALID"],
    ["ATTENDANCE_RATE_LIMITED", 429, "ATTENDANCE_RATE_LIMITED"],
    ["WALLET_NOT_READY", 409, "WALLET_NOT_READY"],
    ["IDEMPOTENCY_KEY_CONFLICT", 409, "IDEMPOTENCY_KEY_CONFLICT"],
    ["ATTENDANCE_INTEGRITY_ERROR", 503, "ATTENDANCE_UNAVAILABLE"],
  ] as const)("maps %s without leaking verifier details", async (failure, status, code) => {
    const run = createPostLiveAttendanceHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { attend: async () => { throw new LiveAttendanceRepositoryError(failure); } } });
    const response = await run(request(), { slug: "kara-first-live" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
    if (failure === "ATTENDANCE_RATE_LIMITED") {
      expect(response.headers.get("retry-after")).toBe("900");
    }
  });
});
