import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createFanpageHandlers } from "./routes";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const commentId = "33333333-3333-4333-8333-333333333333";
const row = { rank: 1, nickname: "별빛팬", avatarUrl: "/images/avatars/star-pink.webp", points: 12 };
const now = "2026-09-08T00:00:00.000Z";
const rpc = vi.fn();
const authorize = vi.fn(async (header: string | null) => { if (header !== "Bearer valid") throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Sign in"); return { appUserId: owner }; });
const authorizeAdmin = vi.fn(async () => ({ appUserId: owner, allowlistId: other, email: "test@example.test", role: "admin" as const }));
const api = createFanpageHandlers({ rpc, authorize, authorizeAdmin });
function request(path = "/api", body?: unknown, authenticated = true, method = "POST") {
  return new Request(`https://byus.kr${path}`, { method, headers: { ...(authenticated ? { authorization: "Bearer valid" } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
}
describe("fanpage server authority", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("rejects invalid credentials on an otherwise public summary", async () => {
    const response = await api.summary(new Request("https://byus.kr/api", { headers: { authorization: "Bearer wrong" } }), "elina");
    expect(response.status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("returns no ranks or own projection at the exact 500 boundary", async () => {
    rpc.mockResolvedValueOnce({ membershipCount: 500, available: false, asOf: now, rows: [], me: null });
    const response = await api.leaderboard(request("/api", undefined, true, "GET"), "elina");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "LEADERBOARD_NOT_AVAILABLE" }, membershipCount: 500 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("read_celebrity_fan_leaderboard", { p_slug: "elina", p_app_user_id: owner, p_locale: "ko" });
  });
  it("returns Top100 at 501 but never trusts a caller's requested owner", async () => {
    rpc.mockResolvedValueOnce({ membershipCount: 501, available: true, asOf: now, rows: [row], me: row });
    const response = await api.leaderboard(request(`/api?appUserId=${other}`, undefined, false, "GET"), "elina");
    expect(response.status).toBe(200); expect((await response.json()).me).toBeNull();
    expect(rpc).toHaveBeenCalledWith("read_celebrity_fan_leaderboard", { p_slug: "elina", p_app_user_id: null, p_locale: "ko" });
  });
  it("passes a validated locale to public read RPCs", async () => {
    rpc.mockResolvedValueOnce({ membershipCount: 0, leaderboardAvailable: false, activity: [] });
    expect((await api.summary(request("/api?locale=en", undefined, false, "GET"), "elina")).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("read_celebrity_fanpage", { p_slug: "elina", p_locale: "en" });
    expect((await api.summary(request("/api?locale=fr", undefined, false, "GET"), "elina")).status).toBe(400);
    expect((await api.summary(request("/api?locale=ko&locale=en", undefined, false, "GET"), "elina")).status).toBe(400);
  });
  it("treats a broken server boundary or private field as unavailable rather than exposing it", async () => {
    rpc.mockResolvedValueOnce({ membershipCount: 500, available: true, asOf: now, rows: [row], me: row });
    expect((await api.leaderboard(request("/api", undefined, false, "GET"), "elina")).status).toBe(503);
    rpc.mockResolvedValueOnce({ membershipCount: 501, available: true, asOf: now, rows: [{ ...row, email: "secret" }], me: null });
    expect((await api.leaderboard(request("/api", undefined, false, "GET"), "elina")).status).toBe(503);
  });
  it("rejects caller-supplied author and trims the permitted comment", async () => {
    expect((await api.postComment(request("/api", { body: "hi", idempotencyKey: other, appUserId: other }), "elina", "notice")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ id: commentId, replayed: false });
    expect((await api.postComment(request("/api", { body: "  응원해요  ", idempotencyKey: other }), "elina", "notice")).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("post_celebrity_notice_comment", { p_app_user_id: owner, p_slug: "elina", p_notice_slug: "notice", p_body: "응원해요", p_idempotency_key: other });
  });
  it("rejects oversized chunks before reading the rest of the body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel });
    const req = new Request("https://byus.kr/api", { method: "POST", headers: { authorization: "Bearer valid" }, body: stream, duplex: "half" } as RequestInit);
    expect((await api.postComment(req, "elina", "notice")).status).toBe(413);
    expect(cancel).toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["FANPAGE_RATE_LIMITED", 429], ["FANPAGE_IDEMPOTENCY_CONFLICT", 409], ["FANPAGE_NOT_FOUND", 404]])("preserves %s", async (code, status) => {
    rpc.mockRejectedValueOnce(new Error(code));
    expect((await api.postComment(request("/api", { body: "hi", idempotencyKey: other }), "elina", "notice")).status).toBe(status);
  });
  it("never leaks database error text", async () => {
    rpc.mockRejectedValueOnce(new Error("secret database internals"));
    const response = await api.removeComment(request(), commentId);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
  it("sends only the authenticated owner to comment removal", async () => {
    rpc.mockResolvedValueOnce(null);
    expect((await api.removeComment(request(`/api?appUserId=${other}`), commentId)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("remove_owned_notice_comment", { p_app_user_id: owner, p_comment_id: commentId });
  });
  it("preserves keyset cursors and owner-scoped comment projection", async () => {
    const comment = { id: commentId, body: "hello", nickname: "fan", avatarUrl: row.avatarUrl, createdAt: now, isOwner: true };
    rpc.mockResolvedValueOnce({ total: 2, comments: [comment] });
    const response = await api.comments(request("/api?limit=1", undefined, true, "GET"), "elina", "notice");
    const result = await response.json(); expect(result.comments).toEqual([comment]);
    expect(JSON.parse(Buffer.from(result.nextCursor, "base64url").toString())).toEqual({ at: now, id: commentId });
    expect(rpc).toHaveBeenLastCalledWith("read_celebrity_notice_comments", expect.objectContaining({ p_locale: "ko" }));
  });
  it("requires admin authorization and bounded nonempty reasons", async () => {
    rpc.mockResolvedValueOnce(null);
    expect((await api.hideComment(request("/api", { reason: "운영 기준 위반" }), commentId)).status).toBe(200);
    expect(authorizeAdmin).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("hide_admin_notice_comment", expect.objectContaining({ p_actor_app_user_id: owner, p_actor_admin_allowlist_id: other, p_comment_id: commentId, p_reason: "운영 기준 위반" }));
    expect((await api.hideComment(request("/api", { reason: " " }), commentId)).status).toBe(400);
  });
  it("uses a stable tuple cursor and an explicit lookahead for admin comments", async () => {
    const comments = Array.from({ length: 51 }, (_, index) => ({
      id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
      body: `comment ${index + 1}`,
      nickname: "fan",
      celebritySlug: "elina",
      noticeSlug: "notice",
      createdAt: now,
    }));
    rpc.mockResolvedValueOnce({ comments });
    const first = await api.adminComments(request("/api", undefined, true, "GET"));
    const body = await first.json();
    expect(body.comments).toHaveLength(50);
    expect(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString())).toEqual({
      at: now,
      id: comments[49].id,
    });
    expect(rpc).toHaveBeenLastCalledWith("read_admin_notice_comments", expect.objectContaining({
      p_before: null,
      p_before_id: null,
      p_limit: 51,
    }));

    rpc.mockResolvedValueOnce({ comments: [] });
    const second = await api.adminComments(request(`/api?cursor=${encodeURIComponent(body.nextCursor)}`, undefined, true, "GET"));
    expect(second.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("read_admin_notice_comments", expect.objectContaining({
      p_before: now,
      p_before_id: comments[49].id,
    }));

    rpc.mockResolvedValueOnce({ comments: comments.slice(0, 50) });
    const exactPage = await api.adminComments(request("/api", undefined, true, "GET"));
    expect((await exactPage.json()).nextCursor).toBeNull();
  });
  it("rejects malformed admin comment cursors before calling the RPC", async () => {
    expect((await api.adminComments(request("/api?cursor=broken", undefined, true, "GET"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("forwards the legacy timestamp cursor to the compatible four-argument RPC", async () => {
    rpc.mockResolvedValueOnce({ comments: [] });
    expect((await api.adminComments(request(`/api?before=${encodeURIComponent(now)}`, undefined, true, "GET"))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("read_admin_notice_comments", {
      p_actor_app_user_id: owner,
      p_actor_admin_allowlist_id: other,
      p_slug: null,
      p_before: now,
    });

    expect((await api.adminComments(request(`/api?before=${encodeURIComponent(now)}&cursor=broken`, undefined, true, "GET"))).status).toBe(400);
  });
  it("requires an explicit boolean to change activity visibility", async () => {
    rpc.mockResolvedValueOnce({ enabled: false });
    expect((await api.visibility(request("/api", undefined, true, "GET"))).status).toBe(200);
    expect((await api.visibility(request("/api", { enabled: "true" }, true, "PATCH"))).status).toBe(400);
    rpc.mockResolvedValueOnce({ enabled: true });
    expect((await api.visibility(request("/api", { enabled: true }, true, "PATCH"))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("set_owned_fan_activity_visibility", { p_app_user_id: owner, p_enabled: true });
  });
});
