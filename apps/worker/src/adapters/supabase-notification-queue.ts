import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NotificationDelivery } from "../notification-domain.js";
import type { NotificationQueue } from "../notification-ports.js";
type RpcClient = Pick<SupabaseClient, "rpc">;
function row(value: Record<string, unknown>): NotificationDelivery {
  return {
    id: String(value.id),
    notificationId: String(value.notification_id),
    kind: String(value.kind) as NotificationDelivery["kind"],
    endpoint: String(value.endpoint),
    p256dh: String(value.p256dh),
    authSecret: String(value.auth_secret),
    attemptCount: Number(value.attempt_count),
    leaseOwner: String(value.lease_owner),
    leaseExpiresAt: String(value.lease_expires_at),
  };
}
export class SupabaseNotificationQueue implements NotificationQueue {
  constructor(private readonly client: RpcClient) {}
  static create(url: string, key: string) {
    return new SupabaseNotificationQueue(
      createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
    );
  }
  async enqueueDue(now: string) {
    const { data, error } = await this.client.rpc(
      "enqueue_due_fan_notifications",
      { p_now: now },
    );
    if (error) throw new Error("notification enqueue failed");
    return Number(data ?? 0);
  }
  async claim(workerId: string, batchSize: number, leaseSeconds: number) {
    const { data, error } = await this.client.rpc(
      "claim_notification_deliveries",
      {
        p_worker_id: workerId,
        p_batch_size: batchSize,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw new Error("notification queue claim failed");
    return ((data ?? []) as Record<string, unknown>[]).map(row);
  }
  async complete(delivery: NotificationDelivery) {
    const { data, error } = await this.client.rpc(
      "complete_notification_delivery",
      { p_delivery_id: delivery.id, p_worker_id: delivery.leaseOwner },
    );
    if (error || data !== true)
      throw new Error("notification delivery lease is stale");
  }
  async retry(
    delivery: NotificationDelivery,
    failure: { code: string; retryable: boolean; disableSubscription: boolean },
  ) {
    const { data, error } = await this.client.rpc(
      "retry_notification_delivery",
      {
        p_delivery_id: delivery.id,
        p_worker_id: delivery.leaseOwner,
        p_error_code: failure.code,
        p_retryable: failure.retryable,
        p_disable_subscription: failure.disableSubscription,
      },
    );
    if (error || data !== true)
      throw new Error("notification delivery lease is stale");
  }
}
