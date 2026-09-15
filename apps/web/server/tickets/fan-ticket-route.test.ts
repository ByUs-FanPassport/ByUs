import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createGetFanTicketsHandler } from "./fan-ticket-route";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const rpc = vi.fn();
const authorize = vi.fn(async (authorization: string | null) => {
  if (authorization !== "Bearer valid") throw new AuthError("AUTHENTICATION_REQUIRED", 401, "private");
  return { appUserId: owner };
});
const handler = createGetFanTicketsHandler({ rpc, authorize });
const valid = {
  enabled: true, creator: { slug: "elina", name: "엘리나" }, balance: 3, today: "2026-09-15",
  actions: [{ key: "verification", amount: 1, status: "awarded", href: "/c/elina/verify" }],
  history: [{ id, sequence: 21, sourceType: "verification", label: "팬 인증", amount: 1, createdAt: "2026-09-15T01:00:00.000Z", occurredAt: null, backfill: false, balance: 3 }],
  nextBefore: "21",
};
function request(query = "creator=elina", authorization = "Bearer valid") {
  return new Request(`https://byus.kr/api/me/tickets?${query}`, { headers: { authorization } });
}

describe("owned fan ticket activity route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires authentication before reading owned activity", async () => {
    const response = await handler(request("creator=elina", "Bearer wrong"));
    expect(response.status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("injects the authorized owner and preserves decimal pagination", async () => {
    rpc.mockResolvedValueOnce(valid);
    expect((await handler(request(`creator=elina&before=21&appUserId=${other}`))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_owned_fan_ticket_activity", { p_app_user_id: owner, p_slug: "elina", p_before_sequence: "21", p_limit: 20, p_locale: "ko" });
  });
  it.each(["creator=elina&before=0", "creator=elina&before=1.2", "creator=elina&before=21&before=20", "creator=elina&creator=yuna", "creator=elina&locale=fr", "creator=elina&locale=ko&locale=en", "before=2"])("rejects malformed query %s", async (query) => {
    expect((await handler(request(query))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed or cross-creator RPC results without leaking details", async () => {
    rpc.mockResolvedValueOnce({ ...valid, balance: Number.MAX_SAFE_INTEGER + 1 });
    expect((await handler(request())).status).toBe(503);
    rpc.mockResolvedValueOnce({ ...valid, creator: { slug: "yuna", name: "유나" } });
    const response = await handler(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("yuna");
  });
});
