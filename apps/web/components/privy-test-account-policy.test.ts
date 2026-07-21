import { describe, expect, it } from "vitest";
import { isPrivyTestAccountLoginEnabled } from "./privy-test-account-policy";

describe("public Privy Test Account policy", () => {
  it("opens only with the explicit development-app flag on a non-production URL", () => {
    expect(isPrivyTestAccountLoginEnabled({
      appUrl: "http://localhost:3000",
      appEnvironment: "development",
      enabled: "true",
    })).toBe(true);
  });

  it.each([
    ["https://byus.kr", "development", "true"],
    ["https://www.byus.kr", "development", "true"],
    ["https://preview.byus.vercel.app", "production", "true"],
    ["https://preview.byus.vercel.app", "development", "false"],
    [undefined, "development", "true"],
  ])("stays closed for url=%s environment=%s enabled=%s", (appUrl, appEnvironment, enabled) => {
    expect(isPrivyTestAccountLoginEnabled({ appUrl, appEnvironment, enabled })).toBe(false);
  });
});
