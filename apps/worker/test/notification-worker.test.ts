import { describe, expect, it, vi } from "vitest";
import {
  NotificationDeliveryError,
  type NotificationDelivery,
} from "../src/notification-domain.js";
import type {
  NotificationQueue,
  PushSender,
} from "../src/notification-ports.js";
import { NotificationWorker } from "../src/notification-worker.js";
const delivery: NotificationDelivery = {
  id: "11111111-1111-4111-8111-111111111111",
  notificationId: "22222222-2222-4222-8222-222222222222",
  kind: "live_10m",
  endpoint: "https://push.example/sub",
  p256dh: "p".repeat(40),
  authSecret: "a".repeat(16),
  attemptCount: 1,
  leaseOwner: "notify-1",
  leaseExpiresAt: "2099-01-01T00:00:00Z",
};
function queue(items = [delivery]): NotificationQueue {
  return {
    claim: vi.fn(async () => items),
    complete: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}
describe("NotificationWorker", () => {
  it("completes each leased subscription delivery once", async () => {
    const q = queue();
    const sender: PushSender = { send: vi.fn(async () => undefined) };
    expect(
      await new NotificationWorker(q, sender, {
        workerId: "notify-1",
        batchSize: 25,
        leaseSeconds: 120,
      }).runOnce(),
    ).toBe(1);
    expect(sender.send).toHaveBeenCalledOnce();
    expect(q.complete).toHaveBeenCalledWith(delivery);
    expect(q.retry).not.toHaveBeenCalled();
  });
  it("does not send a completed idempotency key when the queue does not reclaim it", async () => {
    const q = queue([]);
    const sender: PushSender = { send: vi.fn(async () => undefined) };
    expect(
      await new NotificationWorker(q, sender, {
        workerId: "notify-1",
        batchSize: 25,
        leaseSeconds: 120,
      }).runOnce(),
    ).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("retries transient provider failures without completing", async () => {
    const q = queue();
    const sender: PushSender = {
      send: vi.fn(async () => {
        throw new NotificationDeliveryError("PUSH_RATE_LIMITED", true);
      }),
    };
    await new NotificationWorker(q, sender, {
      workerId: "notify-1",
      batchSize: 25,
      leaseSeconds: 120,
    }).runOnce();
    expect(q.retry).toHaveBeenCalledWith(delivery, {
      code: "PUSH_RATE_LIMITED",
      retryable: true,
      disableSubscription: false,
    });
    expect(q.complete).not.toHaveBeenCalled();
  });
  it("permanently disables gone subscriptions", async () => {
    const q = queue();
    const sender: PushSender = {
      send: vi.fn(async () => {
        throw new NotificationDeliveryError(
          "PUSH_SUBSCRIPTION_GONE",
          false,
          true,
        );
      }),
    };
    await new NotificationWorker(q, sender, {
      workerId: "notify-1",
      batchSize: 25,
      leaseSeconds: 120,
    }).runOnce();
    expect(q.retry).toHaveBeenCalledWith(delivery, {
      code: "PUSH_SUBSCRIPTION_GONE",
      retryable: false,
      disableSubscription: true,
    });
  });
  it("never sends after the claimed lease expired", async () => {
    const expired = { ...delivery, leaseExpiresAt: "2020-01-01T00:00:00Z" };
    const q = queue([expired]);
    const sender: PushSender = { send: vi.fn(async () => undefined) };
    await new NotificationWorker(q, sender, {
      workerId: "notify-1",
      batchSize: 25,
      leaseSeconds: 120,
    }).runOnce();
    expect(sender.send).not.toHaveBeenCalled();
    expect(q.complete).not.toHaveBeenCalled();
    expect(q.retry).not.toHaveBeenCalled();
  });
});
