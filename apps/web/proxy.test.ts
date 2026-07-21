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
