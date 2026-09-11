import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientProductEventV1Schema } from "../domain/product-event";
import { createSignupFunnelTracker, SIGNUP_CONTEXT_TTL_MS } from "./signup-funnel-tracker";

describe("best-effort signup observations", () => {
  beforeEach(() => window.sessionStorage.clear());

  function fixture() {
    let now = Date.parse("2026-09-11T13:00:00Z");
    const record = vi.fn(async () => true);
    const environment = {
      storage: () => window.sessionStorage, now: () => now, uuid: () => crypto.randomUUID(),
      userAgent: () => "Mozilla/5.0 (iPhone) AppleWebKit Safari Instagram 400.0",
      location: () => ({ href: "https://byus.test/pages/elina-fan-guide?utm_source=private-secret&fbclid=private-click", referrer: "https://l.instagram.com/private/path" }),
      record,
    };
    return { environment, record, tracker: createSignupFunnelTracker(environment), advance: (ms = 1) => { now += ms; } };
  }

  it("records unknown guide audience immediately and preserves link-context without raw URL/referrer", () => {
    const f = fixture();
    f.tracker.guideView("elina", "ko", "unknown");
    f.tracker.guideView("elina", "ko", "guest");
    f.tracker.guideCta("elina", "ko", "guest", "verify", "hero");
    expect(f.record).toHaveBeenCalledTimes(2);
    const calls = f.record.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0][0].properties).toMatchObject({ audience: "unknown", channel: "social", browser: "instagram", guide: "elina" });
    expect(calls[1][0].properties).toMatchObject({ action: "verify", placement: "hero", audience: "guest" });
    for (const [event] of calls) {
      expect(JSON.stringify(event)).not.toMatch(/private|https:|utm_|fbclid|Mozilla|AppleWebKit/);
      expect(clientProductEventV1Schema.safeParse({ ...event, schemaVersion: 1, anonymousSessionId: "anonymous-session-123456" }).success).toBe(true);
    }
    expect(JSON.stringify(Object.values(window.sessionStorage))).not.toMatch(/private|https:|utm_|fbclid|Mozilla/);
  });

  it("resumes the same anonymous attempt after navigation without creating a second start", () => {
    const f = fixture();
    f.tracker.guideView("elina", "ko", "guest");
    const attempt = f.tracker.beginLogin("google", "provider", "ko")!;
    const nextDocument = createSignupFunnelTracker(f.environment);
    const resumed = nextDocument.resumeLogin("ko");
    expect(resumed?.nonce).toBe(attempt.nonce);
    f.advance();
    nextDocument.result(resumed, "succeeded", "session", "none");
    nextDocument.result(resumed, "succeeded", "session", "none");
    expect(f.record).toHaveBeenCalledTimes(3);
    expect(f.record.mock.calls.at(-1)?.length).toBe(1); // No access token argument.
    const result = f.record.mock.calls.at(-1) as unknown as [{ idempotencyKey: string }];
    expect(result[0].idempotencyKey).toBe(`signup-login:${attempt.nonce}:succeeded`);
  });

  it("keeps timeout then recovery on one attempt, and an explicit retry on another", () => {
    const f = fixture();
    const first = f.tracker.beginLogin("apple", "provider", "ko")!;
    f.advance(); f.tracker.result(first, "failed", "oauth", "timeout");
    const retry = f.tracker.beginLogin("apple", "retry", "ko")!;
    f.advance(); f.tracker.result(first, "succeeded", "session", "none");
    expect(f.tracker.pendingLogin()?.nonce).toBe(retry.nonce);
    f.tracker.result(first, "failed", "session", "session_error");
    f.tracker.result(retry, "succeeded", "session", "none");
    const events = (f.record.mock.calls as unknown as Array<[{ idempotencyKey: string }]>).map(([e]) => e.idempotencyKey);
    expect(events).toEqual([
      `signup-login:${first.nonce}:started`, `signup-login:${first.nonce}:failed`,
      `signup-login:${retry.nonce}:started`, `signup-login:${first.nonce}:succeeded`, `signup-login:${retry.nonce}:succeeded`,
    ]);
  });

  it("lets callers continue with storage exceptions and with pending/rejected telemetry", async () => {
    const f = fixture();
    const unavailable = createSignupFunnelTracker({ ...f.environment, storage: () => { throw new Error("blocked"); } });
    expect(() => unavailable.guideView("elina", "ko", "guest")).not.toThrow();
    expect(() => unavailable.guideCta("elina", "ko", "guest", "verify", "hero")).not.toThrow();
    expect(unavailable.beginLogin("google", "provider", "ko")).toBeNull();
    expect(f.record).not.toHaveBeenCalled();
    const pending = createSignupFunnelTracker({ ...f.environment, record: () => new Promise<boolean>(() => undefined) });
    expect(pending.beginLogin("google", "provider", "ko")?.nonce).toBeTruthy();
    const broken = createSignupFunnelTracker({ ...f.environment, record: () => { throw new Error("synchronous recorder error"); } });
    expect(broken.beginLogin("google", "provider", "ko")?.nonce).toBeTruthy();
    const rejected = createSignupFunnelTracker({ ...f.environment, record: () => Promise.reject(new Error("offline")) });
    expect(rejected.beginLogin("apple", "provider", "ko")?.nonce).toBeTruthy();
    await Promise.resolve();
  });

  it("expires old attempts and never reuses another browser's absent state", () => {
    const f = fixture();
    const first = f.tracker.beginLogin("google", "provider", "ko")!;
    f.advance(SIGNUP_CONTEXT_TTL_MS);
    expect(f.tracker.pendingLogin()).toBeNull();
    f.tracker.result(first, "succeeded", "session", "none");
    expect(f.record).toHaveBeenCalledTimes(1);
    window.sessionStorage.clear();
    const restore = f.tracker.resumeLogin("en")!;
    expect(restore.nonce).not.toBe(first.nonce);
    expect(restore.provider).toBe("unknown");
    expect(restore.trigger).toBe("session_restore");
  });
});
