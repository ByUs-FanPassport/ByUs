import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createFanHistoryHandler } from "./fan-history-route";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-26T10:00:00+00:00";
const row = { id, title: "Reward", status: "submitted", occurredAt: at, href: `/benefits/${id}` };
describe("owner activity history", () => {
  it("takes the owner only from authentication and preserves a typed cursor", async () => {
    const rpc = vi.fn().mockResolvedValue({ items: [row], nextCursor: { at, id } });
    const handler = createFanHistoryHandler({ authorize: vi.fn().mockResolvedValue({ appUserId: "owner" }), rpc });
    const response = await handler(new Request("https://byus.test/api/me/activity?kind=applications&locale=en&appUserId=other"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString())).toEqual({ at, id });
    expect(rpc).toHaveBeenCalledWith("get_owned_fan_history", expect.objectContaining({ p_app_user_id: "owner", p_kind: "applications" }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects broken cursors before issuing a query and never downgrades auth", async () => {
    const rpc = vi.fn();
    const authorize = vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "Required"));
    const handler = createFanHistoryHandler({ authorize, rpc });
    expect((await handler(new Request("https://byus.test/api/me/activity?cursor=bad%21"))).status).toBe(400);
    expect((await handler(new Request("https://byus.test/api/me/activity"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
