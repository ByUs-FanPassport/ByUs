import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { createAdminSessionHandler } from "./admin-session-route";

describe("admin session HTTP boundary", () => {
  it("does not expose an admin payload until the server gate succeeds", async () => {
    const authorize = vi.fn().mockRejectedValue(
      new AuthError("ADMIN_NOT_ALLOWLISTED", 403, "not allowlisted"),
    );
    const handler = createAdminSessionHandler({ authorize });
    const response = await handler(
      new Request("https://byus.example/api/admin/session", {
        headers: { authorization: "Bearer private-token" },
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: { code: "FORBIDDEN" } });
    expect(body).not.toContain("private-token");
  });

  it("returns only the minimum authorized session payload", async () => {
    const authorize = vi.fn().mockResolvedValue({ email: "biz@sallylab.io", role: "operator" });
    const handler = createAdminSessionHandler({ authorize });
    const correlationId = "4d5a7d2c-fc5c-42ea-816a-460b1c4d216e";
    const response = await handler(
      new Request("https://byus.example/api/admin/session", {
        headers: {
          authorization: "Bearer token",
          "x-correlation-id": correlationId,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ admin: { email: "biz@sallylab.io", role: "operator" } });
    expect(authorize).toHaveBeenCalledWith({
      authorization: "Bearer token",
      correlationId,
    });
  });

  it("replaces an untrusted correlation header with a database-safe UUID", async () => {
    const authorize = vi.fn().mockResolvedValue({ email: "biz@sallylab.io", role: "viewer" });
    const handler = createAdminSessionHandler({ authorize });
    await handler(
      new Request("https://byus.example/api/admin/session", {
        headers: { authorization: "Bearer token", "x-correlation-id": "not-a-uuid" },
      }),
    );

    expect(authorize).toHaveBeenCalledWith({
      authorization: "Bearer token",
      correlationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
  });

  it("maps missing or invalid credentials to a generic 401", async () => {
    const handler = createAdminSessionHandler({
      authorize: vi.fn().mockRejectedValue(
        new AuthError("AUTHENTICATION_REQUIRED", 401, "token details"),
      ),
    });
    const response = await handler(new Request("https://byus.example/api/admin/session"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });
});
