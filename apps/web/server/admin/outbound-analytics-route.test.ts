import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createGetOutboundAnalyticsHandler } from "./outbound-analytics-route";
import { SupabaseOutboundAnalyticsRepository } from "./outbound-analytics-repository";

const admin = { appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222", email: "admin@example.invalid", role: "admin" as const };
const data = { days: 7, from: "2026-10-05T00:00:00Z", to: "2026-10-11T07:00:00Z", totals: { clicks: 3, sessions: 2 }, rows: [{ campaign: "runmusic", destinationHost: "tickets.example", placement: "fanpage_hero", linkKind: "ticket", clicks: 3, sessions: 2 }], truncated: false };
function setup() {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const authorize = vi.fn().mockResolvedValue(admin);
  return { rpc, authorize, handler: createGetOutboundAnalyticsHandler({ authorize, repository: new SupabaseOutboundAnalyticsRepository({ rpc }) }) };
}
describe("admin outbound analytics", () => {
  it("authorizes first and uses verified admin identifiers with private response headers", async () => {
    const { rpc, authorize, handler } = setup();
    const response = await handler(new Request("https://byus.kr/api/admin/analytics/outbound?days=7", { headers: { authorization: "Bearer admin" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(await response.json()).toEqual(data);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ authorization: "Bearer admin" }));
    expect(rpc).toHaveBeenCalledWith("read_admin_outbound_analytics", { p_actor_app_user_id: admin.appUserId, p_actor_admin_allowlist_id: admin.allowlistId, p_days: 7 });
  });
  it.each([401, 403] as const)("rejects unauthorized access (%i) before database reads", async status => {
    const { rpc, authorize, handler } = setup();
    authorize.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", status, "denied"));
    expect((await handler(new Request("https://byus.kr/api/admin/analytics/outbound"))).status).toBe(status);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["days=07", "days=8", "days=7&days=30", "days=7&actor=attacker"])("rejects arbitrary query %s", async query => {
    const { rpc, handler } = setup();
    expect((await handler(new Request(`https://byus.kr/api/admin/analytics/outbound?${query}`))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not fabricate zero counts or expose database errors", async () => {
    const { rpc, handler } = setup();
    rpc.mockResolvedValue({ data: null, error: { message: "private database details" } });
    const response = await handler(new Request("https://byus.kr/api/admin/analytics/outbound"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "OUTBOUND_ANALYTICS_UNAVAILABLE" } });
  });
  it("rejects mismatched intervals or unexpected identifying fields from the database", async () => {
    const { rpc, handler } = setup();
    for (const invalid of [{ ...data, days: 30 }, { ...data, rows: [{ ...data.rows[0], sessionId: "private" }] }]) {
      rpc.mockResolvedValue({ data: invalid, error: null });
      expect((await handler(new Request("https://byus.kr/api/admin/analytics/outbound"))).status).toBe(503);
    }
  });
});
