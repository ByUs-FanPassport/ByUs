import { describe, expect, it } from "vitest";
import { campaignCommandSchema, campaignOutboundHref, campaignWindow } from "./banksy-campaign";

describe("Banksy campaign boundaries", () => {
  it("rejects arbitrary destinations and forged actor fields", () => {
    const command = { action: "create", id: crypto.randomUUID(), creator: "elina", channel: "instagram", contentType: "story", name: "전시 응모", locale: "ko" };
    expect(campaignCommandSchema.safeParse(command).success).toBe(true);
    expect(campaignCommandSchema.safeParse({ ...command, url: "https://evil.test" }).success).toBe(false);
    expect(campaignCommandSchema.safeParse({ ...command, actor: crypto.randomUUID() }).success).toBe(false);
  });
  it("uses the KST date boundary and current time, including month changes", () => {
    expect(campaignWindow(7, new Date("2026-10-01T00:00:00+09:00"))).toEqual({ from: "2026-09-24T15:00:00.000Z", to: "2026-09-30T15:00:00.000Z" });
  });
  it("drops invalid attribution and only produces an internal tracking path", () => {
    expect(campaignOutboundHref("exhibition", "raffle_receipt", "https://evil.test")).toBe("/o/banksy/exhibition?surface=raffle_receipt");
  });
});
