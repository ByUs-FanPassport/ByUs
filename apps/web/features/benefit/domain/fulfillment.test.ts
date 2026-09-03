import { describe, expect, it } from "vitest";
import {
  canTransitionFulfillment,
  recipientInputSchema,
} from "./fulfillment";

describe("Benefit fulfillment domain", () => {
  it.each([
    ["digital", "ready", "digital_delivered"],
    ["physical_shipping", "information_required", "ready"],
    ["physical_shipping", "ready", "shipping_preparing"],
    ["physical_shipping", "shipping_preparing", "shipping_in_transit"],
    ["physical_shipping", "shipping_in_transit", "shipping_completed"],
    ["on_site_pickup", "information_required", "ready"],
    ["on_site_pickup", "ready", "pickup_available"],
    ["on_site_pickup", "pickup_available", "pickup_completed"],
  ] as const)("allows %s %s -> %s", (method, from, to) => {
    expect(canTransitionFulfillment(method, from, to)).toBe(true);
  });
  it.each([
    ["digital", "ready", "shipping_preparing"],
    ["physical_shipping", "ready", "shipping_in_transit"],
    ["physical_shipping", "shipping_completed", "shipping_in_transit"],
    ["on_site_pickup", "ready", "pickup_completed"],
  ] as const)("rejects %s %s -> %s", (method, from, to) => {
    expect(canTransitionFulfillment(method, from, to)).toBe(false);
  });
  it("requires explicit current consent and validates bounded recipient fields", () => {
    expect(recipientInputSchema.parse({
      consentVersion: "2026-09-v1",
      consented: true,
      name: "홍길동",
      phone: "010-1234-5678",
      postalCode: "12345",
      address1: "서울시 중구",
      address2: "101호",
    })).toMatchObject({ consented: true });
    expect(() => recipientInputSchema.parse({ consentVersion: "2026-09-v1", consented: false, name: "A", phone: "01012345678" })).toThrow();
  });
});
