import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { AuditLogRepositoryError, type AuditLogRepository } from "./audit-log-repository";
import { createGetAuditLogsHandler } from "./audit-log-route";

const item = {
  id: "41",
  actor: { type: "admin" as const, id: "22222222-2222-4222-8222-222222222222", role: "operator" as const },
  action: "live.override.created",
  entity: { type: "live_event", id: "kara-nualeaf" },
  result: "success",
  summary: { result: "success", email: "[REDACTED]" },
  correlationId: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-07-21T12:00:00.000Z",
};

function dependencies(repository?: Partial<AuditLogRepository>) {
  return {
    authorize: vi.fn(async () => ({ email: "ops@byus.test", role: "operator" as const, appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222" })),
    repository: {
      read: vi.fn(async () => ({ items: [item], nextCursor: { createdAt: item.createdAt, id: item.id } })),
      ...repository,
    } as AuditLogRepository,
  };
}

describe("ADM-012 audit log HTTP boundary", () => {
  it("authorizes canonically, forwards filters, and returns an opaque stable cursor", async () => {
    const deps = dependencies();
    const response = await createGetAuditLogsHandler(deps)(new Request(
      "https://byus.test/api/admin/audit-logs?limit=20&actor=22222222-2222-4222-8222-222222222222&entityType=live_event&entityId=kara-nualeaf&action=live.override.created&result=success&from=2026-07-01T00%3A00%3A00Z&to=2026-08-01T00%3A00%3A00Z&correlation=33333333-3333-4333-8333-333333333333",
      { headers: { authorization: "Bearer private", "x-correlation-id": "44444444-4444-4444-8444-444444444444" } },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    const body = await response.json();
    expect(body.items).toEqual([item]);
    expect(body.nextCursor).toEqual(expect.any(String));
    expect(deps.authorize).toHaveBeenCalledWith({ authorization: "Bearer private", correlationId: "44444444-4444-4444-8444-444444444444" });
    expect(deps.repository.read).toHaveBeenCalledWith(expect.objectContaining({
      adminAllowlistId: "22222222-2222-4222-8222-222222222222",
      limit: 20,
      filters: expect.objectContaining({ entityType: "live_event", result: "success" }),
    }));

    await createGetAuditLogsHandler(deps)(new Request(
      `https://byus.test/api/admin/audit-logs?cursor=${encodeURIComponent(body.nextCursor)}`,
      { headers: { authorization: "Bearer private" } },
    ));
    expect(deps.repository.read).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: { createdAt: item.createdAt, id: item.id },
    }));
  });

  it("rejects unknown, duplicate, invalid, and forged cursor input before authorization", async () => {
    for (const query of ["appUserId=attacker", "limit=1&limit=2", "actor=nope", "cursor=forged", "from=not-a-date"]) {
      const deps = dependencies();
      const response = await createGetAuditLogsHandler(deps)(new Request(`https://byus.test/api/admin/audit-logs?${query}`));
      expect(response.status).toBe(400);
      expect(deps.authorize).not.toHaveBeenCalled();
    }
  });

  it("maps canonical auth and repository failures to private generic errors", async () => {
    const unauthorized = dependencies();
    unauthorized.authorize.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "token detail"));
    const forbidden = dependencies();
    forbidden.authorize.mockRejectedValue(new AuthError("ADMIN_NOT_ALLOWLISTED", 403, "email detail"));
    const unavailable = dependencies({ read: vi.fn(async () => { throw new AuditLogRepositoryError(); }) });
    expect((await createGetAuditLogsHandler(unauthorized)(new Request("https://byus.test/api/admin/audit-logs"))).status).toBe(401);
    expect((await createGetAuditLogsHandler(forbidden)(new Request("https://byus.test/api/admin/audit-logs"))).status).toBe(403);
    const response = await createGetAuditLogsHandler(unavailable)(new Request("https://byus.test/api/admin/audit-logs", { headers: { authorization: "Bearer token" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "AUDIT_LOGS_UNAVAILABLE" } });
  });
});
