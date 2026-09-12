import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createCommunityStampHandlers } from "./routes";
const owner = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
const authorize = vi.fn(async (header: string | null) => {
  if (header !== "Bearer valid") throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Sign in");
  return { appUserId: owner };
});
const api = createCommunityStampHandlers({ rpc, authorize });
const request = (body: unknown = {}, path = "", authenticated = true) => new Request(`https://byus.kr/api/community-stamps${path}`, { method: "POST", headers: authenticated ? { authorization: "Bearer valid" } : {}, body: JSON.stringify(body) });
describe("community stamp authority", () => {
  beforeEach(() => vi.resetAllMocks());
  it("rejects unauthenticated mutation before touching storage", async () => {
    expect((await api.action(request({}, "", false), "welcome")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["share", "subscription", "support", "issue"])("does not expose %s proof bypass", async action => {
    expect((await api.action(request(), action)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ creator: "elina", appUserId: "other" }, { creator: "elina", date: "2026-01-01" }, { creator: "../../other" }])("rejects client authority %j", async body => {
    expect((await api.action(request(body), "check-in")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses verified owner and database date for check-in", async () => {
    rpc.mockResolvedValueOnce({ awarded: false });
    const response = await api.action(request({ creator: "elina" }), "check-in");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ awarded: false });
    expect(rpc).toHaveBeenCalledWith("check_in_community_stamp", { p_app_user_id: owner, p_celebrity_slug: "elina" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("normalizes only the invite code and never caller ownership", async () => {
    rpc.mockResolvedValueOnce({ awarded: true });
    expect((await api.action(request({ code: " abc123 " }), "redeem-invite")).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("redeem_community_stamp_invite", { p_app_user_id: owner, p_code: "ABC123" });
  });
  it("bounds streamed bodies", async () => {
    expect((await api.action(request({ code: "x".repeat(2000) }), "redeem-invite")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed on malformed database result and hides internals", async () => {
    rpc.mockResolvedValueOnce({ awarded: true, privateOwner: owner });
    const response = await api.action(request(), "welcome");
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(owner);
    rpc.mockRejectedValueOnce(new Error("secret database details"));
    expect(await (await api.action(request(), "welcome")).text()).not.toContain("secret");
  });
  it("read owner always comes from verified session", async () => {
    rpc.mockResolvedValueOnce({ stamps: [], today: "2026-09-13" });
    const response = await api.collection(new Request("https://byus.kr/api/community-stamps?creator=elina&appUserId=other", { headers: { authorization: "Bearer valid" } }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_owned_community_stamps", { p_app_user_id: owner, p_celebrity_slug: "elina" });
  });
});
