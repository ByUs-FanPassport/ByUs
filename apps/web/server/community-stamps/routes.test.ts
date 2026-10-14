import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const replacementGuard = vi.hoisted(() => vi.fn(async <T>(mints: T[]) => mints));
vi.mock("../onchain/owner-mint-replacement", () => ({ validateOwnerMintReplacements: replacementGuard }));
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
  beforeEach(() => {
    vi.resetAllMocks();
    replacementGuard.mockImplementation(async (mints) => mints);
  });
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
  it("creates a link for the verified owner without accepting award facts", async () => {
    const token = "a".repeat(32);
    rpc.mockResolvedValueOnce({ token });
    expect(await (await api.action(request({ creator: "elina" }), "share-link")).json()).toEqual({ token });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_community_stamp_share_link", { p_app_user_id: owner, p_celebrity_slug: "elina" });
  });
  it("confirms a visit using only the authenticated visitor and opaque token", async () => {
    const token = "b".repeat(32);
    rpc.mockResolvedValueOnce({ creator: "elina" });
    expect(await (await api.action(request({ token }), "share-visit")).json()).toEqual({ creator: "elina" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("visit_community_stamp_share_link", { p_app_user_id: owner, p_token: token });
  });
  it.each([{ token: "a".repeat(32), senderId: owner }, { token: "a".repeat(32), awarded: true }, { token: "short" }])("rejects forged share evidence %j", async body => {
    expect((await api.action(request(body), "share-visit")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires a session to confirm a share and rejects private projections", async () => {
    expect((await api.action(request({ token: "a".repeat(32) }, "", false), "share-visit")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ creator: "elina", senderId: owner });
    const result = await api.action(request({ token: "a".repeat(32) }), "share-visit");
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(owner);
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
  it("serializes guarded mint facts for every owned community stamp", async () => {
    const oldTx = `0x${"a".repeat(64)}`;
    replacementGuard.mockResolvedValueOnce([{ status: "minted", txHash: oldTx, tokenId: "11" }]);
    rpc.mockResolvedValueOnce({ stamps: [{
      id: "70000000-0000-4000-8000-000000000001", kind: "welcome", celebritySlug: null,
      issuedAt: "2026-09-13T00:00:00.000Z", mint: {
        status: "minted", txHash: `0x${"b".repeat(64)}`, tokenId: "22", nftContract: `0x${"2".repeat(40)}`, metadataUri: "ipfs://replacement.json",
        originalAsset: { nftContract: `0x${"1".repeat(40)}`, tokenId: "11", metadataUri: "ipfs://original.json", txHash: oldTx },
        replacement: { batchId: `0x${"3".repeat(64)}`, sourceActionId: `0x${"4".repeat(64)}`, sourceHub: `0x${"5".repeat(40)}`, blockNumber: "99", blockHash: `0x${"6".repeat(64)}` },
      },
    }], today: "2026-09-13" });
    const response = await api.collection(new Request("https://byus.kr/api/community-stamps", { headers: { authorization: "Bearer valid" } }));
    expect(await response.json()).toMatchObject({ stamps: [{ mint: { txHash: oldTx, tokenId: "11" } }] });
    expect(replacementGuard).toHaveBeenCalledTimes(1);
  });
});
