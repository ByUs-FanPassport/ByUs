import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createGetAdminOverviewHandler } from "./admin-overview-route";
import { AdminOverviewRepositoryError, SupabaseAdminOverviewRepository } from "./admin-overview-repository";
const id = "11111111-1111-4111-8111-111111111111";
const admin = { appUserId: id, allowlistId: id, email: "admin@example.invalid", role: "admin" as const };
const now = () => new Date("2026-09-11T08:00:00.000Z");
const url = "http://localhost/api/admin/analytics/overview";
describe("admin overview route", () => {
  it("authorizes and uses server time with private responses", async () => {
    const read = vi.fn(async () => ({ asOf: now().toISOString() }) as never);
    const authorize = vi.fn(async () => admin);
    const response = await createGetAdminOverviewHandler({ authorize, repository: { read }, now })(new Request(`${url}?days=7`, { headers: { authorization: "Bearer token" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(read).toHaveBeenCalledWith({ adminAppUserId: id, adminAllowlistId: id, days: "7", asOf: now().toISOString() });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ authorization: "Bearer token" }));
  });
  it.each(["?days=0", "?days=365", "?days=7&days=30", "?asOf=2026-01-01", "?days=abc", "?days="])("rejects unsupported queries %s", async (query) => {
    const read = vi.fn();
    const response = await createGetAdminOverviewHandler({ authorize: async () => admin, repository: { read }, now })(new Request(url + query));
    expect(response.status).toBe(400); expect(read).not.toHaveBeenCalled();
  });
  it.each([401, 403] as const)("never reads data after authorization failure %s", async (status) => {
    const read = vi.fn();
    const response = await createGetAdminOverviewHandler({ authorize: async () => { throw new AuthError("AUTHENTICATION_REQUIRED", status, "denied"); }, repository: { read } })(new Request(url));
    expect(response.status).toBe(status); expect(read).not.toHaveBeenCalled();
  });
  it("returns unavailable instead of zero on repository failure", async () => {
    const response = await createGetAdminOverviewHandler({ authorize: async () => admin, repository: { read: async () => { throw new AdminOverviewRepositoryError(); } } })(new Request(url));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: { code: "ADMIN_OVERVIEW_UNAVAILABLE" } });
  });
  it("rejects malformed RPC data and passes both actor IDs", async () => {
    const rpc = vi.fn(async () => ({ data: { members: { total: 0 } }, error: null }));
    await expect(new SupabaseAdminOverviewRepository({ rpc }).read({ adminAppUserId: id, adminAllowlistId: id, days: "30", asOf: now().toISOString() })).rejects.toBeInstanceOf(AdminOverviewRepositoryError);
    expect(rpc).toHaveBeenCalledWith("read_admin_overview", { p_actor_app_user_id: id, p_actor_admin_allowlist_id: id, p_days: 30, p_as_of: now().toISOString() });
  });
});
