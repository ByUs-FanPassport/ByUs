import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { ProductEventRepository } from "./product-event-repository";
import { ProductEventRepositoryError, SupabaseProductEventRepository } from "./product-event-repository";
import { createRecordProductEventHandler } from "./product-event-route";

const now = new Date("2026-09-03T09:00:00.000Z");
const appUserId = "11111111-1111-4111-8111-111111111111";
const input = {
  schemaVersion: 1,
  eventName: "creator_page_view",
  anonymousSessionId: "session-0000000000000001",
  celebrityId: "22222222-2222-4222-8222-222222222222",
  liveEventId: null,
  missionId: null,
  benefitId: null,
  source: "creator_page",
  idempotencyKey: "creator-page:session-1",
  occurredAt: now.toISOString(),
  properties: { locale: "ko" },
} as const;

function repository(overrides: Partial<ProductEventRepository> = {}): ProductEventRepository {
  return { record: vi.fn().mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", replayed: false }), ...overrides };
}

function request(body: unknown, authorization?: string): Request {
  return new Request("https://byus.kr/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
}

describe("product event HTTP boundary", () => {
  it("hashes the anonymous session only on the server before persistence", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "33333333-3333-4333-8333-333333333333", replayed: false },
      error: null,
    });
    const repo = new SupabaseProductEventRepository({ rpc });
    await repo.record({ ...input, appUserId: null });

    const parameters = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(parameters.p_anonymous_session_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(parameters)).not.toContain(input.anonymousSessionId);
  });

  it("records an anonymous event without trusting an owner from JSON", async () => {
    const repo = repository();
    const response = await createRecordProductEventHandler({ identify: vi.fn().mockResolvedValue(null), repository: repo, now: () => now })(request(input));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(repo.record).toHaveBeenCalledWith({ ...input, appUserId: null });
  });

  it("uses only the verified bearer owner and drops the anonymous identifier", async () => {
    const repo = repository();
    const identify = vi.fn().mockResolvedValue({ appUserId });
    const response = await createRecordProductEventHandler({ identify, repository: repo, now: () => now })(request(input, "Bearer valid"));

    expect(response.status).toBe(201);
    expect(repo.record).toHaveBeenCalledWith({ ...input, appUserId, anonymousSessionId: null });
    expect(identify).toHaveBeenCalledWith("Bearer valid");
  });

  it("rejects owner injection, Ticket events, nested properties, and unsafe timestamps", async () => {
    const repo = repository();
    const handler = createRecordProductEventHandler({ identify: vi.fn().mockResolvedValue(null), repository: repo, now: () => now });
    const cases = [
      { ...input, appUserId },
      { ...input, eventName: "ticket_credited" },
      { ...input, properties: { nested: { no: true } } },
      { ...input, occurredAt: "2026-09-03T09:05:00.001Z" },
    ];
    for (const body of cases) expect((await handler(request(body))).status).toBe(400);
    expect(repo.record).not.toHaveBeenCalled();
  });

  it("returns replay and conflict outcomes without changing the first identity", async () => {
    const replay = repository({ record: vi.fn().mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", replayed: true }) });
    const replayResponse = await createRecordProductEventHandler({ identify: vi.fn().mockResolvedValue(null), repository: replay, now: () => now })(request(input));
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ event: { id: "33333333-3333-4333-8333-333333333333", replayed: true } });

    const conflict = repository({ record: vi.fn().mockRejectedValue(new ProductEventRepositoryError("IDEMPOTENCY_CONFLICT")) });
    const conflictResponse = await createRecordProductEventHandler({ identify: vi.fn().mockResolvedValue(null), repository: conflict, now: () => now })(request(input));
    expect(conflictResponse.status).toBe(409);
  });

  it("fails closed for an invalid bearer token", async () => {
    const repo = repository();
    const response = await createRecordProductEventHandler({
      identify: vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required")),
      repository: repo,
      now: () => now,
    })(request(input, "Bearer invalid"));
    expect(response.status).toBe(401);
    expect(repo.record).not.toHaveBeenCalled();
  });
});
