import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createDeleteSubscriptionHandler,
  createGetNotificationsHandler,
  createPatchPreferencesHandler,
  createPutSubscriptionHandler,
  createReadNotificationHandler,
} from "./notification-route";

function dependencies() {
  return {
    authorize: vi.fn(async () => ({
      appUserId: "11111111-1111-4111-8111-111111111111",
    })),
    repository: {
      list: vi.fn(async () => [
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "live_10m" as const,
          title: "곧 시작해요",
          detail: "예약한 LIVE",
          createdAt: "2026-07-22T10:00:00.000Z",
          readAt: null,
          deepLink: "/live/kara-live" as const,
        },
      ]),
      markRead: vi.fn(async () => true),
      markAllRead: vi.fn(async () => undefined),
      putSubscription: vi.fn(async () => undefined),
      deleteSubscription: vi.fn(async () => undefined),
      getPreferences: vi.fn(async () => ({
        liveReminders: true,
        surveyReminders: true,
        benefitNotifications: true,
        browserSubscription: "unsubscribed" as const,
      })),
      patchPreferences: vi.fn(async () => ({
        liveReminders: false,
        surveyReminders: true,
        benefitNotifications: true,
        browserSubscription: "unsubscribed" as const,
      })),
      enqueueDue: vi.fn(async () => 0),
    },
  };
}
describe("notification routes", () => {
  it("returns only the authorized owner's projected inbox", async () => {
    const deps = dependencies();
    const response = await createGetNotificationsHandler(deps)(
      new Request("https://byus.example/notifications?locale=ko", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      unreadCount: 1,
      notifications: [{ deepLink: "/live/kara-live" }],
    });
    expect(deps.repository.list).toHaveBeenCalledWith({
      appUserId: "11111111-1111-4111-8111-111111111111",
      locale: "ko",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("scopes read mutations to the owner", async () => {
    const deps = dependencies();
    const response = await createReadNotificationHandler(deps)(
      new Request("https://byus.example", {
        method: "POST",
        headers: { authorization: "Bearer token" },
      }),
      "22222222-2222-4222-8222-222222222222",
    );
    expect(response.status).toBe(200);
    expect(deps.repository.markRead).toHaveBeenCalledWith({
      appUserId: "11111111-1111-4111-8111-111111111111",
      notificationId: "22222222-2222-4222-8222-222222222222",
    });
  });
  it("accepts canonical HTTPS subscriptions and rejects unsafe endpoints", async () => {
    const deps = dependencies();
    const good = new Request("https://byus.example", {
      method: "PUT",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "https://push.example/subscription",
        keys: { p256dh: "a".repeat(40), auth: "b".repeat(16) },
      }),
    });
    expect((await createPutSubscriptionHandler(deps)(good)).status).toBe(200);
    const bad = new Request("https://byus.example", {
      method: "PUT",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "http://push.example/subscription",
        keys: { p256dh: "a".repeat(40), auth: "b".repeat(16) },
      }),
    });
    expect((await createPutSubscriptionHandler(deps)(bad)).status).toBe(400);
  });
  it("persists explicit preference patches and subscription deletion", async () => {
    const deps = dependencies();
    const patch = new Request("https://byus.example", {
      method: "PATCH",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ liveReminders: false }),
    });
    expect((await createPatchPreferencesHandler(deps)(patch)).status).toBe(200);
    expect(deps.repository.patchPreferences).toHaveBeenCalledWith({
      appUserId: "11111111-1111-4111-8111-111111111111",
      liveReminders: false,
    });
    const del = new Request("https://byus.example", {
      method: "DELETE",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ endpoint: "https://push.example/subscription" }),
    });
    expect((await createDeleteSubscriptionHandler(deps)(del)).status).toBe(200);
  });
});
