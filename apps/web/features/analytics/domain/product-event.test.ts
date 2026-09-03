import { describe, expect, it } from "vitest";

import {
  PRODUCT_EVENT_NAMES,
  assertSafeProductEventTime,
  clientProductEventV1Schema,
  productEventV1Schema,
} from "./product-event";

const base = {
  schemaVersion: 1 as const,
  eventName: "creator_page_view" as const,
  appUserId: null,
  anonymousSessionId: "session-0000000000000001",
  celebrityId: "11111111-1111-4111-8111-111111111111",
  liveEventId: null,
  missionId: null,
  benefitId: null,
  source: "creator_page",
  idempotencyKey: "creator-page:session-1",
  occurredAt: "2026-09-03T09:00:00.000Z",
  properties: { locale: "ko", position: 1, promoted: false, campaign: null },
};

describe("ProductEventV1", () => {
  it("freezes the v1 allowlist including Ticket measurement events", () => {
    expect(PRODUCT_EVENT_NAMES).toContain("ticket_credited");
    expect(PRODUCT_EVENT_NAMES).toContain("ticket_debited");
    expect(PRODUCT_EVENT_NAMES).toHaveLength(16);
    expect(productEventV1Schema.parse(base)).toEqual(base);
  });

  it("requires exactly one authenticated or anonymous owner", () => {
    expect(productEventV1Schema.safeParse({ ...base, anonymousSessionId: null }).success).toBe(false);
    expect(productEventV1Schema.safeParse({ ...base, appUserId: crypto.randomUUID() }).success).toBe(false);
    expect(productEventV1Schema.safeParse({ ...base, appUserId: crypto.randomUUID(), anonymousSessionId: null }).success).toBe(true);
  });

  it("rejects unbounded, nested, and oversized properties", () => {
    expect(productEventV1Schema.safeParse({ ...base, properties: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])) }).success).toBe(false);
    expect(productEventV1Schema.safeParse({ ...base, properties: { nested: { unsafe: true } } }).success).toBe(false);
    expect(productEventV1Schema.safeParse({ ...base, properties: { body: "x".repeat(2_049) } }).success).toBe(false);
  });

  it("keeps Ticket events off the public client boundary", () => {
    const client = { ...base } as Record<string, unknown>;
    delete client.appUserId;
    expect(clientProductEventV1Schema.safeParse({ ...client, eventName: "ticket_credited" }).success).toBe(false);
    expect(clientProductEventV1Schema.safeParse({ ...client, eventName: "ticket_debited" }).success).toBe(false);
  });

  it("accepts only a bounded client clock skew", () => {
    const now = new Date("2026-09-03T09:00:00.000Z");
    expect(() => assertSafeProductEventTime("2026-09-03T09:05:00.000Z", now)).not.toThrow();
    expect(() => assertSafeProductEventTime("2026-09-02T09:00:00.000Z", now)).not.toThrow();
    expect(() => assertSafeProductEventTime("2026-09-03T09:05:00.001Z", now)).toThrow();
    expect(() => assertSafeProductEventTime("2026-09-02T08:59:59.999Z", now)).toThrow();
  });
});
