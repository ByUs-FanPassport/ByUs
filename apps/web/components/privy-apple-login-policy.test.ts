import { describe, expect, it } from "vitest";
import { isPrivyAppleLoginEnabled } from "./privy-apple-login-policy";

describe("public Privy Apple login policy", () => {
  it("opens only for the exact explicit true value", () => {
    expect(isPrivyAppleLoginEnabled("true")).toBe(true);
    expect(isPrivyAppleLoginEnabled("false")).toBe(false);
    expect(isPrivyAppleLoginEnabled(undefined)).toBe(false);
    expect(isPrivyAppleLoginEnabled("TRUE")).toBe(false);
  });
});
