import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enablePushNotifications } from "./push-subscription";

describe("enablePushNotifications", () => {
  const originalPublicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = "AQIDBA";
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn(async () => "granted"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalPublicKey === undefined)
      delete process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    else
      process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = originalPublicKey;
  });

  it("sends only the canonical fields accepted by the strict subscription API", async () => {
    const subscription = {
      toJSON: () => ({
        endpoint: "https://push.example/device",
        expirationTime: null,
        keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) },
      }),
    };
    const register = vi.fn(async () => ({
      pushManager: {
        getSubscription: vi.fn(async () => subscription),
        subscribe: vi.fn(),
      },
    }));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      enablePushNotifications(async () => "access-token"),
    ).resolves.toBe("subscribed");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      endpoint: "https://push.example/device",
      keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) },
    });
  });

  it("does not call the API when the browser subscription omits key material", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: vi.fn(async () => ({
          pushManager: {
            getSubscription: vi.fn(async () => ({
              toJSON: () => ({ endpoint: "https://push.example/device" }),
            })),
            subscribe: vi.fn(),
          },
        })),
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      enablePushNotifications(async () => "access-token"),
    ).resolves.toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
