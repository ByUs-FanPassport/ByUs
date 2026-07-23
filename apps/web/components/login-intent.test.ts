import { describe, expect, it } from "vitest";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "./login-intent";

describe("login return intent", () => {
  it.each([
    ["/live/kara-nualeaf?tab=reservation#cta", "/live/kara-nualeaf?tab=reservation#cta"],
    ["/passports", "/passports"],
    [null, "/"],
    ["https://evil.example/steal", "/"],
    ["//evil.example/steal", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/login?returnTo=/login", "/"],
  ])("sanitizes %s to a same-origin destination", (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });

  it("accepts only declared intent values", () => {
    expect(sanitizeIntent("reserve")).toBe("reserve");
    expect(sanitizeIntent("attendance")).toBe("attendance");
    expect(sanitizeIntent("survey")).toBe("survey");
    expect(sanitizeIntent("benefit-claim")).toBe("benefit-claim");
    expect(sanitizeIntent("passport")).toBe("passport");
    expect(sanitizeIntent("redirect:https://evil.example")).toBeNull();
  });

  it("accepts only UUID intent storage identifiers", () => {
    expect(sanitizeAuthIntentId("11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    expect(sanitizeAuthIntentId("../intent")).toBeNull();
  });

  it("accepts only bounded opaque entity keys and supported locales", () => {
    expect(sanitizeEntity("kara-nualeaf")).toBe("kara-nualeaf");
    expect(sanitizeEntity("../admin")).toBeNull();
    expect(sanitizeEntity("a".repeat(65))).toBeNull();
    expect(sanitizeLocale("en")).toBe("en");
    expect(sanitizeLocale("fr")).toBe("ko");
  });

  it("preserves the sanitized continuation context without interpreting it", () => {
    expect(appendLoginContext("/onboarding/profile", {
      returnTo: "/live/kara-nualeaf?tab=reservation#fan-code",
      intent: "reserve",
      entity: "kara-nualeaf",
      authIntent: "11111111-1111-4111-8111-111111111111",
      locale: "en",
    })).toBe("/onboarding/profile?returnTo=%2Flive%2Fkara-nualeaf%3Ftab%3Dreservation%23fan-code&locale=en&intent=reserve&entity=kara-nualeaf&authIntent=11111111-1111-4111-8111-111111111111");
  });
});
