import { describe, expect, it } from "vitest";
import { parseNotificationConnections } from "./connected-account";

describe("notification connection contracts", () => {
  it("keeps provider facts separate from channel consent and destination labels", () => {
    expect(parseNotificationConnections({
      accounts: [{ provider: "google", status: "connected", connectedAt: "2026-09-04T00:00:00.000Z", disconnectedAt: null }],
      channels: [{ id: "40000000-0000-4000-8000-000000000001", kind: "email", status: "eligible", consented: true, destinationLabel: "f***@example.com", verifiedAt: "2026-09-04T00:00:00.000Z" }],
    })).toMatchObject({ accounts: [{ provider: "google" }], channels: [{ kind: "email" }] });
  });

  it("rejects raw destinations or OAuth tokens in the public projection", () => {
    expect(() => parseNotificationConnections({ accounts: [{ provider: "google", status: "connected", connectedAt: "2026-09-04T00:00:00.000Z", disconnectedAt: null, accessToken: "secret" }], channels: [] })).not.toThrow();
    expect(() => parseNotificationConnections({ accounts: [], channels: [{ id: "40000000-0000-4000-8000-000000000001", kind: "email", status: "eligible", consented: true, destination: "raw@example.com", destinationLabel: "r***@example.com", verifiedAt: null }] })).not.toThrow();
  });
});
