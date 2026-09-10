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
describe("localized action-required notification projection", () => {
  const benefitId = "22222222-2222-4222-8222-222222222222";
  const winnerId = "33333333-3333-4333-8333-333333333333";
  const benefit = {
    id: benefitId,
    benefit_localizations: [
      { locale: "ko", title: "사인 앨범" },
      { locale: "en", title: "Signed album" },
    ],
  };
  it.each([
    ["benefit_won", "You won Signed album"],
    ["recipient_information_required", "Enter recipient information"],
    ["fulfillment_meaningful_update", "Signed album status changed"],
    ["collectible_claim_available", "Your Collectible is ready"],
    ["collectible_claim_expiring", "Your Collectible claim period ends soon"],
  ] as const)("does not leak a stored Korean payload for %s", (kind, expected) => {
    const item = projectNotificationRow({
      ...base,
      kind,
      source_key: kind === "recipient_information_required" ? `recipient_information_required:${winnerId}:1` : `${kind}:test`,
      deep_link: `/benefits/${benefitId}`,
      payload: { title: "한국어 저장 제목", detail: "한국어 저장 본문", fulfillmentStatus: "shipping_in_transit" },
      benefits: benefit,
    }, "en");
    expect(item.title).toBe(expected);
    expect(`${item.title} ${item.detail}`).not.toContain("한국어");
  });
  it.each([
    ["ko", "information_required", "정보 입력 필요"],
    ["ko", "ready", "준비 완료"],
    ["ko", "shipping_preparing", "배송 준비 중"],
    ["ko", "shipping_in_transit", "배송 중"],
    ["ko", "shipping_completed", "배송 완료"],
    ["ko", "pickup_available", "수령 가능"],
    ["ko", "pickup_completed", "수령 완료"],
    ["ko", "digital_delivered", "지급 완료"],
    ["en", "information_required", "Information required"],
    ["en", "ready", "Ready"],
    ["en", "shipping_preparing", "Preparing shipment"],
    ["en", "shipping_in_transit", "In transit"],
    ["en", "shipping_completed", "Delivered"],
    ["en", "pickup_available", "Ready for pickup"],
    ["en", "pickup_completed", "Picked up"],
    ["en", "digital_delivered", "Delivered"],
  ] as const)("localizes the actual fulfillment enum %s/%s", (locale, fulfillmentStatus, expected) => {
    const item = projectNotificationRow({
      ...base,
      kind: "fulfillment_meaningful_update",
      source_key: `fulfillment_meaningful_update:${winnerId}:1`,
      deep_link: `/benefits/${benefitId}`,
      payload: { fulfillmentStatus },
      benefits: benefit,
    }, locale);
    expect(item.detail).toBe(expected);
  });
  it("keeps legacy links by default and derives the recipient route only for opted-in clients", () => {
    const row = {
      ...base,
      kind: "recipient_information_required",
      source_key: `recipient_information_required:${winnerId}:2`,
      deep_link: `/benefits/${benefitId}`,
      payload: {},
      benefits: benefit,
    };
    expect(projectNotificationRow(row, "en").deepLink).toBe(`/benefits/${benefitId}`);
    expect(projectNotificationRow(row, "en", true).deepLink).toBe(`/my/rewards/${winnerId}/recipient`);
    expect(projectNotificationRow({ ...row, source_key: "recipient_information_required:not-a-uuid:2" }, "en", true).deepLink).toBe(`/benefits/${benefitId}`);
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
