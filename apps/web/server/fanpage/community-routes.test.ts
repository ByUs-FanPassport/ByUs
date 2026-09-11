import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/domain/auth-errors";
import { createFanCommunityHandlers } from "./community-routes";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
const now = "2026-09-12T03:00:00.000Z";
const older = "2026-09-12T02:59:00.000Z";
const avatarUrl = "/images/avatars/star-pink.webp";
const first = { id: firstId, body: "응원해요", nickname: "별빛팬", avatarUrl, createdAt: now, isOwner: true };
const second = { id: secondId, body: "함께해요", nickname: "달빛팬", avatarUrl: "/images/avatars/heart-lavender.webp", createdAt: older, isOwner: false };
const rpc = vi.fn();
const authorize = vi.fn(async (authorization: string | null) => {
  if (authorization !== "Bearer valid") throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Sign in");
  return { appUserId: owner };
});
const authorizeAdmin = vi.fn();
const api = createFanCommunityHandlers({ rpc, authorize, authorizeAdmin });

function request(path = "/api", options: { body?: unknown; auth?: string; method?: string } = {}) {
  const method = options.method ?? "GET";
  return new Request(`https://byus.kr${path}`, {
    method,
    headers: {
      ...(options.auth === undefined ? { authorization: "Bearer valid" } : options.auth ? { authorization: options.auth } : {}),
      "content-type": "application/json",
    },
    body: method === "GET" || options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("fan community routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid credential before either public read", async () => {
    expect((await api.fans(request("/api", { auth: "Bearer wrong" }), "elina")).status).toBe(401);
    expect((await api.cheers(request("/api", { auth: "Bearer wrong" }), "elina")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns only the bounded public fan projection", async () => {
    rpc.mockResolvedValueOnce({ likeCount: 3, fanCount: 5, publicFanCount: 1, fans: [{ nickname: "별빛팬", avatarUrl }] });
    const response = await api.fans(request("/api?locale=en", { auth: "" }), "elina");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likeCount: 3, fanCount: 5, publicFanCount: 1, fans: [{ nickname: "별빛팬", avatarUrl }] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(rpc).toHaveBeenCalledWith("read_celebrity_fan_community", { p_slug: "elina", p_locale: "en" });
  });

  it("returns not found for a creator outside the public locale", async () => {
    rpc.mockResolvedValueOnce(null);
    const response = await api.fans(request("/api", { auth: "" }), "missing");
    expect(response.status).toBe(404);
  });

  it("requests one extra cheer and emits a cursor only when another row exists", async () => {
    rpc.mockResolvedValueOnce({ total: 2, comments: [first, second] });
    const response = await api.cheers(request("/api?locale=ko&limit=1"), "elina");
    const body = await response.json();
    expect(body.comments).toEqual([first]);
    expect(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString("utf8"))).toEqual({ at: now, id: firstId });
    expect(rpc).toHaveBeenCalledWith("read_celebrity_cheers", {
      p_slug: "elina", p_app_user_id: owner, p_before: null, p_before_id: null, p_limit: 2, p_locale: "ko",
    });

    rpc.mockResolvedValueOnce({ total: 1, comments: [first] });
    expect((await api.cheers(request("/api?limit=1", { auth: "" }), "elina")).json()).resolves.toEqual({ total: 1, comments: [first], nextCursor: null });
  });

  it("validates locale, limit, cursor, and slug before querying", async () => {
    expect((await api.cheers(request("/api?locale=ko&locale=en"), "elina")).status).toBe(400);
    expect((await api.cheers(request("/api?limit=21"), "elina")).status).toBe(400);
    expect((await api.cheers(request("/api?cursor=not-base64"), "elina")).status).toBe(400);
    expect((await api.fans(request("/api"), "Bad Slug")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("posts a strict top-level cheer as the authenticated owner", async () => {
    rpc.mockResolvedValueOnce({ id: firstId, replayed: false });
    const response = await api.postCheer(request("/api?locale=ko", { method: "POST", body: { body: "  응원해요  ", idempotencyKey: other } }), "elina");
    expect(await response.json()).toEqual({ id: firstId, replayed: false });
    expect(rpc).toHaveBeenCalledWith("post_celebrity_cheer", {
      p_app_user_id: owner, p_slug: "elina", p_body: "응원해요", p_idempotency_key: other, p_locale: "ko",
    });
    expect((await api.postCheer(request("/api", { method: "POST", body: { body: "hi", idempotencyKey: other, replyToId: firstId } }), "elina")).status).toBe(400);
    expect((await api.postCheer(request("/api", { method: "POST", body: { body: "hi", idempotencyKey: other, emoji: "🔥" } }), "elina")).status).toBe(400);
  });

  it("enforces the 8 KiB request bound", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel });
    const oversized = new Request("https://byus.kr/api", { method: "POST", headers: { authorization: "Bearer valid" }, body: stream, duplex: "half" } as RequestInit);
    expect((await api.postCheer(oversized, "elina")).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
  });

  it("uses the existing owner removal authority", async () => {
    rpc.mockResolvedValueOnce(null);
    expect((await api.removeCheer(request("/api", { method: "DELETE" }), firstId)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("remove_owned_lounge_message", { p_app_user_id: owner, p_message_id: firstId });
  });

  it("fails closed on private or malformed RPC fields", async () => {
    rpc.mockResolvedValueOnce({ likeCount: 1, fanCount: 1, publicFanCount: 1, fans: [{ nickname: "별빛팬", avatarUrl, appUserId: owner }] });
    expect((await api.fans(request("/api"), "elina")).status).toBe(503);
    rpc.mockResolvedValueOnce({ total: 1, comments: [{ ...first, email: "secret@example.test" }] });
    expect((await api.cheers(request("/api"), "elina")).status).toBe(503);
  });

  it.each([["FANPAGE_RATE_LIMITED", 429], ["FANPAGE_IDEMPOTENCY_CONFLICT", 409], ["FANPAGE_FORBIDDEN", 403], ["FANPAGE_NOT_FOUND", 404]])("preserves %s from the existing failure map", async (code, status) => {
    rpc.mockRejectedValueOnce(new Error(code));
    expect((await api.postCheer(request("/api", { method: "POST", body: { body: "hi", idempotencyKey: other } }), "elina")).status).toBe(status);
  });
});
