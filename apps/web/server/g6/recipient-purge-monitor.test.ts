import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSupabaseRecipientPurgeMonitorRepository } from "./recipient-purge-monitor-repository";
import { createGetRecipientPurgeStatusHandler } from "./recipient-purge-monitor-route";
const appUserId = "11111111-1111-4111-8111-111111111111", allowlistId = "22222222-2222-4222-8222-222222222222";
const status = { state: "healthy" as const, cadenceHours: 24 as const, lastRunAt: "2026-09-04T00:00:00.000Z", lastSuccessAt: "2026-09-04T00:00:00.000Z", lastErrorCode: null, deletedCount: 0, source: "benefit_maintenance_runs(recipient_purge)" as const };
describe("recipient purge monitor", () => {
  it("maps independent non-PII maintenance health", async () => {
    const rpc = vi.fn(async () => ({ data: status, error: null }));
    await expect(createSupabaseRecipientPurgeMonitorRepository({ url: "x", serviceRoleKey: "x" }, { rpc } as never).read({ appUserId, allowlistId, asOf: new Date("2026-09-04T01:00:00Z") })).resolves.toEqual(status);
    expect(rpc).toHaveBeenCalledWith("read_admin_recipient_purge_status", expect.objectContaining({ p_actor_app_user_id: appUserId }));
  });
  it("authorizes the Admin API and returns no-store status", async () => {
    const handler = createGetRecipientPurgeStatusHandler({ authorize: vi.fn(async () => ({ appUserId, allowlistId, role: "admin" as const, email: "admin@example.invalid" })), repository: { read: vi.fn(async () => status) }, now: () => new Date("2026-09-04T01:00:00Z") });
    const response = await handler(new Request("https://byus.kr/api/admin/maintenance/recipient-purge", { headers: { authorization: "Bearer x" } }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
