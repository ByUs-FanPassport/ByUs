import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { notificationItemSchema } from "../../features/notification/domain/notification-model";
import {
  createNotificationRepository,
  NotificationSubscriptionBusyError,
  projectNotificationRow,
} from "./notification-repository";
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-07-22T00:00:00.000Z",
  read_at: null,
  live_events: null,
};
describe("FAN-019 progress notification projection", () => {
  it("renders a level-up from its versioned payload and stored safe link", () => {
    const item = projectNotificationRow(
      {
        ...base,
        kind: "level_up",
        deep_link: "/passports",
        payload: { schemaVersion: 1, currentLevel: "Gold" },
        benefits: null,
      },
      "ko",
    );
    expect(notificationItemSchema.parse(item)).toMatchObject({
      kind: "level_up",
      title: "팬 레벨이 Gold로 올랐어요",
      deepLink: "/passports",
    });
  });
  it("renders benefit unlock localization and exact stored link", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const item = projectNotificationRow(
      {
        ...base,
        kind: "benefit_unlocked",
        deep_link: `/benefits/${id}`,
        payload: { schemaVersion: 1 },
        benefits: {
          id,
          benefit_localizations: [{ locale: "ko", title: "VIP Meet & Greet" }],
        },
      },
      "ko",
    );
    expect(notificationItemSchema.parse(item)).toMatchObject({
      kind: "benefit_unlocked",
      title: "VIP Meet & Greet 혜택이 열렸어요",
      deepLink: `/benefits/${id}`,
    });
  });
});
describe("push subscription ownership", () => {
  it("registers through the atomic RPC rather than a table upsert", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const from = vi.fn();
    const repository = createNotificationRepository(
      { url: "https://unused.example", serviceRoleKey: "unused" },
      { rpc, from } as never,
    );
    await repository.putSubscription({
      appUserId: "11111111-1111-4111-8111-111111111111",
      endpoint: "https://push.example/device",
      p256dh: "p".repeat(40),
      auth: "a".repeat(16),
      userAgent: null,
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "register_push_subscription",
      expect.objectContaining({
        p_app_user_id: "11111111-1111-4111-8111-111111111111",
        p_endpoint_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });
  it("maps a busy ownership transfer without exposing the endpoint", async () => {
    const repository = createNotificationRepository(
      { url: "https://unused.example", serviceRoleKey: "unused" },
      {
        rpc: vi.fn(async () => ({ data: null, error: { code: "55P03" } })),
        from: vi.fn(),
      } as never,
    );
    await expect(
      repository.putSubscription({
        appUserId: "11111111-1111-4111-8111-111111111111",
        endpoint: "https://push.example/device",
        p256dh: "p".repeat(40),
        auth: "a".repeat(16),
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(NotificationSubscriptionBusyError);
  });
});
