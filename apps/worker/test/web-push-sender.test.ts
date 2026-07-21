import { beforeEach, describe, expect, it, vi } from "vitest";
const { setVapidDetails, sendNotification } = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("web-push", () => ({ default: { setVapidDetails, sendNotification } }));
import { WebPushSender } from "../src/adapters/web-push-sender.js";
const delivery = {
  id: "11111111-1111-4111-8111-111111111111",
  notificationId: "22222222-2222-4222-8222-222222222222",
  kind: "live_10m" as const,
  endpoint: "https://push.example/sub",
  p256dh: "p".repeat(40),
  authSecret: "a".repeat(16),
  attemptCount: 1,
  leaseOwner: "notify-1",
  leaseExpiresAt: "2099-01-01T00:00:00Z",
};
describe("WebPushSender", () => {
  beforeEach(() => vi.clearAllMocks());
  it("configures VAPID signing and sends only the notification id as navigation authority", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const sender = new WebPushSender({
      subject: "mailto:ops@byus.example",
      publicKey: "A".repeat(88),
      privateKey: "B".repeat(43),
    });
    await sender.send(delivery);
    expect(setVapidDetails).toHaveBeenCalledWith(
      "mailto:ops@byus.example",
      "A".repeat(88),
      "B".repeat(43),
    );
    const call = sendNotification.mock.calls[0];
    expect(call).toBeDefined();
    const [subscription, payload, options] = call!;
    expect(subscription).toEqual({
      endpoint: delivery.endpoint,
      keys: { p256dh: delivery.p256dh, auth: delivery.authSecret },
    });
    expect(JSON.parse(payload)).toMatchObject({
      notificationId: delivery.notificationId,
    });
    expect(JSON.parse(payload)).not.toHaveProperty("deepLink");
    expect(options).toMatchObject({ urgency: "high", TTL: 86400 });
  });
  it("classifies 410 as a permanent gone subscription", async () => {
    sendNotification.mockRejectedValue({ statusCode: 410 });
    const sender = new WebPushSender({
      subject: "mailto:ops@byus.example",
      publicKey: "A".repeat(88),
      privateKey: "B".repeat(43),
    });
    await expect(sender.send(delivery)).rejects.toMatchObject({
      code: "PUSH_SUBSCRIPTION_GONE",
      retryable: false,
      disableSubscription: true,
    });
  });
});
