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
  locale: "en" as const,
  endpoint: "https://fcm.googleapis.com/fcm/send/sub",
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
      locale: "en",
      title: "Your reserved LIVE starts in 10 minutes",
      body: "Your LIVE is about to begin.",
    });
    expect(JSON.parse(payload)).not.toHaveProperty("deepLink");
    expect(options).toMatchObject({
      urgency: "high",
      TTL: 86400,
      timeout: 10_000,
    });
  });
  it.each(["ko", "en"] as const)("has complete %s copy for every notification kind", async (locale) => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const sender = new WebPushSender({ subject: "mailto:ops@byus.example", publicKey: "A".repeat(88), privateKey: "B".repeat(43) });
    const kinds = ["live_24h", "live_10m", "live_reserved", "live_changed", "live_cancelled", "survey_reminder", "benefit_available", "level_up", "benefit_unlocked", "benefit_won", "recipient_information_required", "fulfillment_meaningful_update", "collectible_claim_available", "collectible_claim_expiring"] as const;
    for (const kind of kinds) await sender.send({ ...delivery, locale, kind });
    for (const call of sendNotification.mock.calls) {
      const payload = JSON.parse(call[1]);
      expect(payload.locale).toBe(locale);
      expect(payload.title).toEqual(expect.any(String));
      expect(payload.body).toEqual(expect.any(String));
    }
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
  it("does not retry a provider redirect response", async () => {
    sendNotification.mockRejectedValue({ statusCode: 302 });
    const sender = new WebPushSender({
      subject: "mailto:ops@byus.example",
      publicKey: "A".repeat(88),
      privateKey: "B".repeat(43),
    });
    await expect(sender.send(delivery)).rejects.toMatchObject({
      code: "PUSH_REJECTED",
      retryable: false,
      disableSubscription: false,
    });
    expect(sendNotification).toHaveBeenCalledOnce();
  });
  it.each([
    "https://127.0.0.1/sub",
    "https://[::1]/sub",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com.evil.example/sub",
    "https://user:password@fcm.googleapis.com/sub",
    "https://fcm.googleapis.com:8443/sub",
    "https://fcm.googleapis.com/sub#fragment",
    " https://fcm.googleapis.com/sub",
    "https://fcm.googleapis.com\\@127.0.0.1/sub",
  ])("permanently disables hostile endpoint %s before network access", async (endpoint) => {
    const sender = new WebPushSender({
      subject: "mailto:ops@byus.example",
      publicKey: "A".repeat(88),
      privateKey: "B".repeat(43),
    });
    await expect(sender.send({ ...delivery, endpoint })).rejects.toMatchObject({
      code: "INVALID_PUSH_ENDPOINT",
      retryable: false,
      disableSubscription: true,
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
