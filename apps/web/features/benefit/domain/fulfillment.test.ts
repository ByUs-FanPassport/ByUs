import { describe, expect, it } from "vitest";
import {
  BENEFIT_RECIPIENT_CONSENT_VERSION,
  canTransitionFulfillment,
  recipientInputSchema,
  recipientSaveResultSchema,
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
      consentVersion: BENEFIT_RECIPIENT_CONSENT_VERSION,
      consented: true,
      name: "홍길동",
      phone: "010-1234-5678",
      postalCode: "12345",
      address1: "서울시 중구",
      address2: "101호",
    })).toMatchObject({ consented: true });
    expect(() => recipientInputSchema.parse({ consentVersion: "2026-09-v1", consented: false, name: "A", phone: "01012345678" })).toThrow();
  });

  it("accepts a normalized v2 international contact and Unicode recipient name", () => {
    expect(recipientInputSchema.parse({
      consentVersion: BENEFIT_RECIPIENT_CONSENT_VERSION,
      consented: true,
      name: "山田 太郎",
      phone: "+819012345678",
      phoneCountry: "JP",
      expectedRevision: 0,
    })).toMatchObject({ name: "山田 太郎", phoneCountry: "JP", expectedRevision: 0 });
  });

  it("requires normalized phone and Korean address fields for v2 shipping", () => {
    expect(recipientInputSchema.parse({
      consentVersion: BENEFIT_RECIPIENT_CONSENT_VERSION,
      consented: true,
      name: "Alex Kim",
      phone: "+12133734253",
      phoneCountry: "US",
      shippingCountry: "KR",
      expectedRevision: 2,
      postalCode: "04524",
      address1: "서울특별시 중구 세종대로 110",
    })).toMatchObject({ shippingCountry: "KR", postalCode: "04524" });

    expect(() => recipientInputSchema.parse({
      consentVersion: BENEFIT_RECIPIENT_CONSENT_VERSION,
      consented: true,
      name: "Alex Kim",
      phone: "2133734253",
      phoneCountry: "US",
      shippingCountry: "KR",
      expectedRevision: 2,
      postalCode: "1234",
      address1: "",
    })).toThrow();
  });

  it("accepts only the non-digital ready result returned by recipient submission", () => {
    expect(recipientSaveResultSchema.parse({
      winnerId: "11111111-1111-4111-8111-111111111111",
      method: "physical_shipping",
      status: "ready",
      revision: 2,
    })).toMatchObject({ status: "ready", revision: 2 });
    expect(() => recipientSaveResultSchema.parse({
      winnerId: "11111111-1111-4111-8111-111111111111",
      method: "digital",
      status: "ready",
      revision: 2,
    })).toThrow();
  });
});
