import { describe, expect, it } from "vitest";
import { sanitizeIntent, sanitizeReturnTo } from "./login-intent";

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
    expect(sanitizeIntent("passport")).toBe("passport");
    expect(sanitizeIntent("redirect:https://evil.example")).toBeNull();
  });
});
