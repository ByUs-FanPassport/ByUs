import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuditLogRepositoryError, SupabaseAuditLogRepository } from "./audit-log-repository";

function database(input?: { rows?: unknown; rpcError?: unknown }) {
  return {
    client: {
      rpc: vi.fn(async () => ({ data: input?.rows ?? [], error: input?.rpcError ?? null })),
    },
  };
}

describe("Supabase audit log repository", () => {
  it("passes the canonical allowlist identity and asks the guarded RPC for one lookahead row", async () => {
    const db = database();
    const repository = new SupabaseAuditLogRepository(db.client as never);
    await repository.read({ adminAllowlistId: "11111111-1111-4111-8111-111111111111", limit: 25, filters: {} });
    expect(db.client.rpc).toHaveBeenCalledWith("read_admin_audit_logs", expect.objectContaining({
      p_actor_admin_allowlist_id: "11111111-1111-4111-8111-111111111111",
      p_limit: 26,
    }));
  });

  it("fails closed when the guarded RPC rejects the actor or returns a malformed projection", async () => {
    await expect(new SupabaseAuditLogRepository(database({ rpcError: { message: "active administrator is required" } }).client as never).read({ adminAllowlistId: "11111111-1111-4111-8111-111111111111", limit: 10, filters: {} })).rejects.toBeInstanceOf(AuditLogRepositoryError);
    await expect(new SupabaseAuditLogRepository(database({ rows: [{ raw_secret: "leak" }] }).client as never).read({ adminAllowlistId: "11111111-1111-4111-8111-111111111111", limit: 10, filters: {} })).rejects.toBeInstanceOf(AuditLogRepositoryError);
  });
});
