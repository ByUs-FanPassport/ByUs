import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("admin API proxy prefilter", () => {
  it("rejects a missing bearer header without an admin payload", async () => {
    const response = proxy(new NextRequest("https://byus.example/api/admin/session"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });

  it("only forwards structurally valid bearer requests to the authoritative route gate", () => {
    const request = new NextRequest("https://byus.example/api/admin/session", {
      headers: { authorization: "Bearer opaque-token" },
    });
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("page locale proxy", () => {
  it("forwards a validated query locale to SSR", () => {
    const response = proxy(new NextRequest("https://byus.example/c/kara?locale=en"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-byus-locale")).toBe("en");
  });

  it("uses Korean when the URL does not select a locale", () => {
    const request = new NextRequest("https://byus.example/passports", {
      headers: { cookie: "byus_locale=en" },
    });
    const response = proxy(request);

    expect(response.headers.get("x-middleware-request-x-byus-locale")).toBe("ko");
  });

  it("defaults invalid locale input to Korean even when a stale cookie is present", () => {
    const response = proxy(
      new NextRequest("https://byus.example/?locale=fr", {
        headers: { cookie: "byus_locale=en" },
      }),
    );

    expect(response.headers.get("x-middleware-request-x-byus-locale")).toBe("ko");
  });

  it("uses the existing Admin lang query contract instead of the fan locale query", () => {
    const english = proxy(new NextRequest("https://byus.example/admin?lang=en&locale=ko"));
    const korean = proxy(new NextRequest("https://byus.example/admin?lang=ko&locale=en"));

    expect(english.headers.get("x-middleware-request-x-byus-locale")).toBe("en");
    expect(korean.headers.get("x-middleware-request-x-byus-locale")).toBe("ko");
  });
});
