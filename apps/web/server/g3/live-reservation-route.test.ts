import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { LiveReservationRepositoryError } from "./live-reservation-repository";
import { createPostLiveReservationHandler } from "./live-reservation-route";

const liveEventId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const result = {
  reservation: {
    id: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-07-21T12:00:00.000Z",
    stamp: {
      id: "44444444-4444-4444-8444-444444444444",
      businessStatus: "issued" as const,
      mintStatus: "queued" as const,
    },
  },
};

function request(body: unknown = { idempotencyKey }, authorization = "Bearer token") {
  return new Request(`https://byus.example/api/live-events/${liveEventId}/reservation`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify(body),
  });
}

describe("POST live reservation handler", () => {
  it("derives the owner from the canonical session and returns only the UI summary", async () => {
    const reserve = vi.fn().mockResolvedValue(result);
    const run = createPostLiveReservationHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { reserve } });
    const response = await run(request(), { liveEventId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(reserve).toHaveBeenCalledWith({ appUserId: "owner-id", liveEventId, idempotencyKey });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    [{ idempotencyKey, appUserId: "attacker" }],
    [{ idempotencyKey, wallet: "0x1234" }],
    [{ idempotencyKey, points: 999 }],
    [{ idempotencyKey, payload: {} }],
    [{ idempotencyKey: "not-a-uuid" }],
  ])("rejects non-canonical body %o", async (body) => {
    const reserve = vi.fn();
    const run = createPostLiveReservationHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { reserve } });
    const response = await run(request(body), { liveEventId });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("requires a canonical authenticated owner", async () => {
    const run = createPostLiveReservationHandler({ authorize: async () => { throw new AuthError("AUTHENTICATION_REQUIRED", 401, "invalid"); }, repository: { reserve: vi.fn() } });
    const response = await run(request(), { liveEventId });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTHENTICATION_REQUIRED" } });
  });

  it.each([
    ["LIVE_NOT_FOUND", 404, "LIVE_NOT_FOUND"],
    ["RESERVATION_UNAVAILABLE", 409, "RESERVATION_UNAVAILABLE"],
    ["RESERVATION_WINDOW_CLOSED", 409, "RESERVATION_WINDOW_CLOSED"],
    ["PASSPORT_REQUIRED", 403, "PASSPORT_REQUIRED"],
    ["WALLET_NOT_READY", 409, "WALLET_NOT_READY"],
    ["IDEMPOTENCY_KEY_CONFLICT", 409, "IDEMPOTENCY_KEY_CONFLICT"],
    ["RESERVATION_INTEGRITY_ERROR", 503, "RESERVATION_UNAVAILABLE"],
  ] as const)("maps %s to stable HTTP response", async (failure, status, code) => {
    const run = createPostLiveReservationHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { reserve: async () => { throw new LiveReservationRepositoryError(failure); } } });
    const response = await run(request(), { liveEventId });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });

  it("returns the same successful summary for an idempotent replay", async () => {
    const reserve = vi.fn().mockResolvedValue(result);
    const run = createPostLiveReservationHandler({ authorize: async () => ({ appUserId: "owner-id" }), repository: { reserve } });
    expect(await (await run(request(), { liveEventId })).json()).toEqual(result);
    expect(await (await run(request(), { liveEventId })).json()).toEqual(result);
  });
});
