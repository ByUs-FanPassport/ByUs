import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGetNotificationDeliveriesHandler, createRetryNotificationDeliveryHandler } from "./notification-monitor-route";

const id = "11111111-1111-4111-8111-111111111111";
const admin = { appUserId: id, allowlistId: "22222222-2222-4222-8222-222222222222", email: "a@example.com", role: "operator" as const };
const monitor = { counts: { pending: 0, processing: 0, sent: 0, failed: 0 }, items: [], nextCursor: null };

describe("notification monitor route", () => {
  it("lists for Viewer without mutation", async () => {
    const list = vi.fn(async () => monitor);
    const response = await createGetNotificationDeliveriesHandler({ authorize: async () => ({ ...admin, role: "viewer" as const }), repository: { list, retry: vi.fn() } })(new Request("https://x/api/admin/notification-deliveries?status=failed"));
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("returns and accepts an opaque stable cursor", async () => {
    const cursor = { createdAt: "2026-09-04T00:00:00.000Z", id };
    const list = vi.fn().mockResolvedValue({ ...monitor, nextCursor: cursor });
    const handler = createGetNotificationDeliveriesHandler({ authorize: async () => admin, repository: { list, retry: vi.fn() } });
    const first = await handler(new Request("https://x/api/admin/notification-deliveries?limit=25"));
    const firstBody = await first.json();
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    await handler(new Request(`https://x/api/admin/notification-deliveries?limit=25&cursor=${encodeURIComponent(firstBody.nextCursor)}`));
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }));
  });

  it("denies Viewer retry before repository", async () => {
    const retry = vi.fn();
    const response = await createRetryNotificationDeliveryHandler({ authorize: async () => ({ ...admin, role: "viewer" as const }), repository: { list: vi.fn(), retry } })(new Request("https://x", { method: "POST", headers: { "idempotency-key": id, "x-correlation-id": id } }), { id });
    expect(response.status).toBe(403);
    expect(retry).not.toHaveBeenCalled();
  });

  it("accepts exact operator retry", async () => {
    const retry = vi.fn(async () => ({ id, status: "pending" as const, retried: true }));
    const response = await createRetryNotificationDeliveryHandler({ authorize: async () => admin, repository: { list: vi.fn(), retry } })(new Request("https://x", { method: "POST", headers: { "idempotency-key": id, "x-correlation-id": id } }), { id });
    expect(response.status).toBe(202);
    expect(retry).toHaveBeenCalledOnce();
  });
});
