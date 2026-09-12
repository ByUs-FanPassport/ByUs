import { describe, expect, it, vi } from "vitest";
import { clientProductEventV1Schema, productEventV1Schema } from "./product-event";
import { createRecordProductEventHandler } from "../../../server/analytics/product-event-route";
vi.mock("server-only", () => ({}));

const nonce = "11111111-1111-4111-8111-111111111111";
const properties = {
  channel: "social", landing: "fan_guide", guide: "elina", browser: "instagram", os: "ios", locale: "ko",
  provider: "google", trigger: "provider",
};
const started = {
  schemaVersion: 1, eventName: "login_started", source: "signup.login",
  idempotencyKey: `signup-login:${nonce}:started`, occurredAt: "2026-09-11T13:00:00Z",
  anonymousSessionId: "anonymous-session-123456", celebrityId: null, liveEventId: null, missionId: null, benefitId: null,
  properties,
};

describe("signup measurement privacy boundary", () => {
  it("accepts only anonymous observations with fixed properties", () => {
    expect(clientProductEventV1Schema.safeParse(started).success).toBe(true);
    for (const unsafe of [
      { properties: { ...properties, email: "private@example.test" } },
      { properties: { ...properties, guide: "/c/private-user" } },
      { properties: { ...properties, browser: "full-user-agent" } },
      { source: "server.commit_projection" },
      { celebrityId: nonce }, { anonymousSessionId: null },
      { idempotencyKey: "signup-login:private-session:started" },
    ]) expect(clientProductEventV1Schema.safeParse({ ...started, ...unsafe }).success).toBe(false);
    expect(productEventV1Schema.safeParse({ ...started, appUserId: nonce, anonymousSessionId: null }).success).toBe(false);
  });

  it("separates a successful observation from failed or contradictory result payloads", () => {
    const success = { ...started, eventName: "login_result", idempotencyKey: `signup-login:${nonce}:succeeded`,
      properties: { ...properties, outcome: "succeeded", stage: "session", reason: "none" } };
    expect(clientProductEventV1Schema.safeParse(success).success).toBe(true);
    expect(clientProductEventV1Schema.safeParse({ ...success, properties: { ...success.properties, stage: "wallet" } }).success).toBe(false);
    expect(clientProductEventV1Schema.safeParse({ ...success, idempotencyKey: `signup-login:${nonce}:failed` }).success).toBe(false);
    expect(clientProductEventV1Schema.safeParse({ ...success, properties: { ...success.properties, error: "raw provider secret" } }).success).toBe(false);
    expect(clientProductEventV1Schema.safeParse({ ...success, idempotencyKey: `signup-login:${nonce}:failed`,
      properties: { ...properties, outcome: "failed", stage: "oauth", reason: "timeout" } }).success).toBe(true);
  });

  it("validates the complete bounded wallet diagnostic group and success semantics", () => {
    const diagnostic = { walletWaitOutcome: "timeout", walletWaitMs: 30000,
      walletReconciliation: "wallet_found", walletReconciliationMs: 120 };
    const event = { ...started, eventName: "login_result", idempotencyKey: `signup-login:${nonce}:succeeded`,
      properties: { ...properties, outcome: "succeeded", stage: "session", reason: "none", ...diagnostic } };
    expect(clientProductEventV1Schema.safeParse(event).success).toBe(true);
    for (const patch of [
      { walletWaitMs: -1 }, { walletWaitMs: 120001 }, { walletWaitMs: 1.5 },
      { walletReconciliationMs: 30001 }, { walletReconciliationMs: null },
      { walletWaitOutcome: "private SDK error" }, { walletReconciliation: "wallet_missing" },
      { walletWaitOutcome: "succeeded" }, { walletWaitMs: undefined },
      { walletAddress: "private-wallet" },
    ]) expect(clientProductEventV1Schema.safeParse({ ...event, properties: { ...event.properties, ...patch } }).success).toBe(false);
  });

  it("delivers validated diagnostics through the real anonymous API handler", async () => {
    const diagnostic = { walletWaitOutcome: "timeout", walletWaitMs: 30000,
      walletReconciliation: "wallet_missing", walletReconciliationMs: 100 };
    const event = { ...started, eventName: "login_result", idempotencyKey: `signup-login:${nonce}:failed`,
      properties: { ...properties, outcome: "failed", stage: "wallet", reason: "timeout", ...diagnostic } };
    const identify = vi.fn(async () => null);
    const record = vi.fn(async () => ({ id: nonce, replayed: false }));
    const handler = createRecordProductEventHandler({ identify, repository: { record }, now: () => new Date(started.occurredAt) });
    const response = await handler(new Request("https://byus.test/api/events", {
      method: "POST", body: JSON.stringify(event),
    }));
    expect(response.status).toBe(201);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]).toEqual([expect.objectContaining({ appUserId: null,
      properties: expect.objectContaining(diagnostic) })]);
  });

  it.each(["account_created", "profile_completed"])("keeps %s server-only", (eventName) => {
    expect(clientProductEventV1Schema.safeParse({ ...started, eventName }).success).toBe(false);
  });

  it("rejects authenticated ownership before even resolving an identity", async () => {
    const identify = vi.fn(async () => ({ appUserId: nonce }));
    const record = vi.fn(async () => ({ id: nonce, replayed: false }));
    const handler = createRecordProductEventHandler({ identify, repository: { record }, now: () => new Date(started.occurredAt) });
    const response = await handler(new Request("https://byus.test/api/events", {
      method: "POST", headers: { authorization: "Bearer private-token" }, body: JSON.stringify(started),
    }));
    expect(response.status).toBe(400);
    expect(identify).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
