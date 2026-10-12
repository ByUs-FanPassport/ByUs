import { describe, expect, it } from "vitest";
import { notificationCollectionSchema, safeNotificationPathSchema } from "./notification-model";

const id = "11111111-1111-4111-8111-111111111111";
const notification = {
  id,
  title: "알림",
  detail: "본문",
  createdAt: "2026-10-12T00:00:00.000Z",
  readAt: null,
};

describe("notification recipient links", () => {
  it("accepts a mixed collection containing the exact recipient route", () => {
    expect(notificationCollectionSchema.parse({
      notifications: [
        { ...notification, kind: "live_reserved", deepLink: "/live/kara-live" },
        { ...notification, id: "22222222-2222-4222-8222-222222222222", kind: "recipient_information_required", deepLink: `/my/rewards/${id}/recipient` },
      ],
      unreadCount: 2,
    }).notifications).toHaveLength(2);
  });

  it.each([
    `https://evil.example/my/rewards/${id}/recipient`,
    `/my/rewards/${id}/recipient?next=https://evil.example`,
    `/my/rewards/${id}/recipient#details`,
    "/my/rewards/not-a-uuid/recipient",
    `/my/rewards/${id}/recipient/extra`,
  ])("rejects recipient route variation %s", (path) => {
    expect(safeNotificationPathSchema.safeParse(path).success).toBe(false);
  });
});
