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
      recipientLinks: false,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("opts into recipient routes only with one exact query flag", async () => {
    const deps = dependencies();
    await createGetNotificationsHandler(deps)(new Request(
      "https://byus.example/notifications?locale=en&recipientLinks=1",
      { headers: { authorization: "Bearer token" } },
    ));
    expect(deps.repository.list).toHaveBeenLastCalledWith(expect.objectContaining({
      locale: "en",
      recipientLinks: true,
    }));
    await createGetNotificationsHandler(deps)(new Request(
      "https://byus.example/notifications?recipientLinks=1&recipientLinks=1",
      { headers: { authorization: "Bearer token" } },
    ));
    expect(deps.repository.list).toHaveBeenLastCalledWith(expect.objectContaining({ recipientLinks: false }));
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
  it("accepts trusted browser push subscriptions and rejects unsafe endpoints", async () => {
    const deps = dependencies();
    const good = new Request("https://byus.example", {
      method: "PUT",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/subscription",
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
    expect(deps.repository.putSubscription).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://127.0.0.1/subscription",
    "https://[::1]/subscription",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com.evil.example/subscription",
    "https://evilfcm.googleapis.com/subscription",
    "https://user:password@fcm.googleapis.com/subscription",
    "https://fcm.googleapis.com:8443/subscription",
    "https://fcm.googleapis.com/subscription#redirect",
    " https://fcm.googleapis.com/subscription",
    "https://fcm.googleapis.com\\@127.0.0.1/subscription",
  ])("rejects hostile push endpoint %s", async (unsafeEndpoint) => {
    const deps = dependencies();
    const response = await createPutSubscriptionHandler(deps)(
      new Request("https://byus.example", {
        method: "PUT",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          endpoint: unsafeEndpoint,
          keys: { p256dh: "a".repeat(40), auth: "b".repeat(16) },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(deps.repository.putSubscription).not.toHaveBeenCalled();
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
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/subscription",
      }),
    });
    expect((await createDeleteSubscriptionHandler(deps)(del)).status).toBe(200);
  });
});
