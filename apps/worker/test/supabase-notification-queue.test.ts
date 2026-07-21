import { describe, expect, it, vi } from "vitest";
import { SupabaseNotificationQueue } from "../src/adapters/supabase-notification-queue.js";
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  notification_id: "22222222-2222-4222-8222-222222222222",
  kind: "live_24h",
  endpoint: "https://push.example/sub",
  p256dh: "p",
  auth_secret: "a",
  attempt_count: 2,
  lease_owner: "notify-1",
  lease_expires_at: "2099-01-01T00:00:00Z",
};
describe("SupabaseNotificationQueue", () => {
  it("claims with bounded lease inputs and maps private subscription credentials", async () => {
    const rpc = vi.fn(async () => ({ data: [row], error: null }));
    const queue = new SupabaseNotificationQueue({ rpc } as never);
    expect(await queue.claim("notify-1", 25, 120)).toMatchObject([
      { id: row.id, authSecret: "a", attemptCount: 2 },
    ]);
    expect(rpc).toHaveBeenCalledWith("claim_notification_deliveries", {
      p_worker_id: "notify-1",
      p_batch_size: 25,
      p_lease_seconds: 120,
    });
  });
  it("refuses stale completion instead of direct table fallback", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const queue = new SupabaseNotificationQueue({ rpc } as never);
    await expect(
      queue.complete({
        id: row.id,
        notificationId: row.notification_id,
        kind: "live_24h",
        endpoint: row.endpoint,
        p256dh: "p",
        authSecret: "a",
        attemptCount: 2,
        leaseOwner: "notify-1",
        leaseExpiresAt: row.lease_expires_at,
      }),
    ).rejects.toThrow("stale");
    expect(rpc).toHaveBeenCalledOnce();
  });
});
