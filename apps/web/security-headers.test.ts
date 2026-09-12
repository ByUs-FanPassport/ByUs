import { describe, expect, it } from "vitest";
import { responseSecurityHeaders } from "./security-headers";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "./next.config";

function header(name: string): string {
  const value = responseSecurityHeaders.find(
    ({ key }) => key.toLowerCase() === name.toLowerCase(),
  )?.value;
  expect(value, `${name} must be configured`).toBeTypeOf("string");
  return value as string;
}

describe("response security headers", () => {
  it("allows app scripts on the connection landing while OAuth documents remain script-free", async () => {
    const landing = await unstable_getResponseFromNextConfig({ url: "https://byus.kr/connect/instagram", nextConfig });
    expect(landing.headers.get("content-security-policy")).toContain("https://auth.privy.io");
    expect(landing.headers.get("content-security-policy")).not.toContain("default-src 'none'");
    for (const route of ["start", "callback", "confirm", "deletion-status"]) {
      const document = await unstable_getResponseFromNextConfig({ url: `https://byus.kr/connect/instagram/${route}`, nextConfig });
      expect(document.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(document.headers.get("content-security-policy")).not.toContain("https://auth.privy.io");
    }
  });
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

  it("allows published LIVE preview media from Supabase Storage", () => {
    const csp = header("Content-Security-Policy");

    expect(csp).toContain("media-src 'self' blob: https://*.supabase.co");
    expect(csp).not.toContain("media-src *");
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
