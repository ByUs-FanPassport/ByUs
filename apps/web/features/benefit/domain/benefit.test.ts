import { describe, expect, it } from "vitest";
import { deriveBenefitState, parseSafeExternalHttpsUrl } from "./benefit";

const benefit = {
  id: "11111111-1111-4111-8111-111111111111",
  available: true,
  claimOpensAt: "2026-07-21T00:00:00.000Z",
  claimClosesAt: "2026-07-22T00:00:00.000Z",
  minimumScore: 5,
  minimumLevel: "Silver" as const,
  requiredStampType: "knowledge",
  requiredActivityType: "knowledge",
};
const eligible = {
  authenticated: true,
  hasPassport: true,
  score: 5,
  level: "Silver" as const,
  stampTypes: new Set(["knowledge"]),
  activityTypes: new Set(["knowledge"]),
  claimedBenefitIds: new Set<string>(),
};

describe("benefit state", () => {
  it("derives owner-specific states without exposing delivery material", () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    expect(deriveBenefitState(benefit, eligible, now)).toBe("eligible");
    expect(deriveBenefitState(benefit, null, now)).toBe("locked");
    expect(deriveBenefitState({ ...benefit, available: false }, eligible, now)).toBe("sold_out");
    expect(deriveBenefitState(benefit, eligible, new Date("2026-07-22T00:00:00.000Z"))).toBe("expired");
    expect(deriveBenefitState(benefit, { ...eligible, claimedBenefitIds: new Set([benefit.id]) }, now)).toBe("claimed");
  });

  it("accepts only parsed HTTPS delivery URLs without credentials", () => {
    expect(parseSafeExternalHttpsUrl("https://example.com/reward?id=1")).toBe("https://example.com/reward?id=1");
    expect(() => parseSafeExternalHttpsUrl("javascript:alert(1)")).toThrow();
    expect(() => parseSafeExternalHttpsUrl("http://example.com/reward")).toThrow();
    expect(() => parseSafeExternalHttpsUrl("https://user:secret@example.com/reward")).toThrow();
  });
});
