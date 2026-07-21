import { describe, expect, it } from "vitest";
import { responseSecurityHeaders } from "./security-headers";

function header(name: string): string {
  const value = responseSecurityHeaders.find(
    ({ key }) => key.toLowerCase() === name.toLowerCase(),
  )?.value;
  expect(value, `${name} must be configured`).toBeTypeOf("string");
  return value as string;
}

describe("response security headers", () => {
  it("denies framing and constrains executable content", () => {
    const csp = header("Content-Security-Policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("default-src *");
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("allows only the Privy integration origins required by the active login flow", () => {
    const csp = header("Content-Security-Policy");

    expect(csp).toContain("frame-src https://auth.privy.io");
    expect(csp).toContain("connect-src 'self' https://auth.privy.io");
    expect(csp).toContain("https://*.rpc.privy.systems");
    expect(csp).not.toContain("frame-src *");
    expect(csp).not.toContain("connect-src *");
  });

  it("sets MIME, referrer, capability, and cross-origin isolation policies", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    expect(header("Cross-Origin-Opener-Policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(header("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });
});
