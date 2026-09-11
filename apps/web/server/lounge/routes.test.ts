import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/domain/auth-errors";
import { createLoungeHandlers } from "./routes";

const owner = "11111111-1111-4111-8111-111111111111";
const adminAllowlistId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const replyId = "44444444-4444-4444-8444-444444444444";
const now = "2026-09-12T01:00:00.000Z";
const avatarUrl = "/images/avatars/star-pink.webp";
const message = {
  id: messageId,
  body: "반가워요",
  nickname: "별빛팬",
  avatarUrl,
  createdAt: now,
  isOwner: true,
  replyTo: { id: replyId, body: "어서 와요", nickname: "달빛팬" },
  reactions: [{ emoji: "❤️", count: 2, reacted: true }],
};

const rpc = vi.fn();
const authorize = vi.fn(async (authorization: string | null) => {
  if (authorization !== "Bearer valid") {
    throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Sign in");
  }
  return { appUserId: owner };
});
const authorizeAdmin = vi.fn(async () => ({
  appUserId: owner,
  allowlistId: adminAllowlistId,
  email: "admin@example.test",
  role: "admin" as const,
}));
const api = createLoungeHandlers({ rpc, authorize, authorizeAdmin });

function request(path = "/api", options: { body?: unknown; auth?: string; method?: string } = {}) {
  const method = options.method ?? "POST";
  return new Request(`https://byus.kr${path}`, {
    method,
    headers: {
      ...(options.auth === undefined ? { authorization: "Bearer valid" } : options.auth ? { authorization: options.auth } : {}),
      "content-type": "application/json",
    },
    body: method === "GET" || options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("fan lounge server authority", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid credentials before a public lounge read", async () => {
    const response = await api.read(request("/api", { auth: "Bearer wrong", method: "GET" }), "elina");
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns not found when the creator is not publicly readable", async () => {
    rpc.mockResolvedValueOnce(null);
    const response = await api.read(request("/api", { auth: "", method: "GET" }), "missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "FANPAGE_NOT_FOUND" } });
  });

  it("returns a newest-first page with an opaque keyset cursor", async () => {
    rpc.mockResolvedValueOnce({ likeCount: 7, total: 2, messages: [message] });
    const response = await api.read(request("/api?locale=en&limit=1", { auth: "", method: "GET" }), "elina");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(body.messages).toEqual([message]);
    expect(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString("utf8"))).toEqual({ at: now, id: messageId });
    expect(rpc).toHaveBeenCalledWith("read_celebrity_lounge", {
      p_slug: "elina", p_app_user_id: null, p_before: null, p_before_id: null,
      p_limit: 1, p_ids: null, p_locale: "en",
    });
  });

  it("uses canonical IDs mode without pagination", async () => {
    rpc.mockResolvedValueOnce({ likeCount: 7, total: 1, messages: [message] });
    const response = await api.read(request(`/api?ids=${messageId},${replyId}`, { method: "GET" }), "elina");
    expect(await response.json()).toEqual({ likeCount: 7, total: 1, messages: [message], nextCursor: null });
    expect(rpc).toHaveBeenCalledWith("read_celebrity_lounge", expect.objectContaining({ p_ids: [messageId, replyId], p_app_user_id: owner }));
  });

  it("rejects malformed slugs, duplicated locale, mixed cursor IDs, and too many IDs", async () => {
    const cursor = Buffer.from(JSON.stringify({ at: now, id: messageId })).toString("base64url");
    expect((await api.read(request("/api", { method: "GET" }), "Bad Slug")).status).toBe(400);
    expect((await api.read(request("/api?locale=ko&locale=en", { method: "GET" }), "elina")).status).toBe(400);
    expect((await api.read(request(`/api?cursor=${cursor}&ids=${messageId}`, { method: "GET" }), "elina")).status).toBe(400);
    expect((await api.read(request(`/api?ids=${Array.from({ length: 201 }, () => messageId).join(",")}`, { method: "GET" }), "elina")).status).toBe(400);
  });

  it("posts only the authenticated author with a nullable reply", async () => {
    rpc.mockResolvedValueOnce({ id: messageId, replayed: false });
    const response = await api.post(request("/api?locale=ko", { body: { body: "  안녕하세요  ", idempotencyKey: replyId, replyToId: null } }), "elina");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: messageId, replayed: false });
    expect(rpc).toHaveBeenCalledWith("post_celebrity_lounge_message", {
      p_app_user_id: owner, p_slug: "elina", p_body: "안녕하세요",
      p_idempotency_key: replyId, p_reply_to_id: null, p_locale: "ko",
    });
  });

  it("enforces strict JSON and the 8 KiB body bound", async () => {
    expect((await api.post(request("/api", { body: { body: "hi", idempotencyKey: replyId, appUserId: owner } }), "elina")).status).toBe(400);
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel });
    const oversized = new Request("https://byus.kr/api", { method: "POST", headers: { authorization: "Bearer valid" }, body: stream, duplex: "half" } as RequestInit);
    expect((await api.post(oversized, "elina")).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
  });

  it("removes only as the authenticated owner", async () => {
    rpc.mockResolvedValueOnce(null);
    expect((await api.remove(request(), messageId)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("remove_owned_lounge_message", { p_app_user_id: owner, p_message_id: messageId });
  });

  it("sets an allowlisted emoji to the requested durable state", async () => {
    rpc.mockResolvedValueOnce(null);
    const response = await api.react(request("/api", { body: { emoji: "🔥", enabled: false }, method: "PUT" }), messageId);
    expect(await response.json()).toEqual({ updated: true });
    expect(rpc).toHaveBeenCalledWith("set_lounge_message_reaction", { p_app_user_id: owner, p_message_id: messageId, p_emoji: "🔥", p_enabled: false });
    expect((await api.react(request("/api", { body: { emoji: "💩", enabled: true }, method: "PUT" }), messageId)).status).toBe(400);
  });

  it("returns a bounded admin page and keyset cursor", async () => {
    rpc.mockResolvedValueOnce({ messages: [{ id: messageId, body: "안녕", nickname: "별빛팬", celebritySlug: "elina", createdAt: now }] });
    const response = await api.adminList(request("/api?limit=1", { method: "GET" }));
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
    expect(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString("utf8"))).toEqual({ at: now, id: messageId });
    expect(rpc).toHaveBeenCalledWith("read_admin_lounge_messages", expect.objectContaining({ p_limit: 1, p_actor_app_user_id: owner, p_actor_admin_allowlist_id: adminAllowlistId }));
  });

  it("requires admin authority and a bounded moderation reason", async () => {
    rpc.mockResolvedValueOnce(null);
    expect((await api.adminHide(request("/api", { body: { reason: "운영 기준 위반" } }), messageId)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("hide_admin_lounge_message", expect.objectContaining({ p_message_id: messageId, p_reason: "운영 기준 위반" }));
    expect((await api.adminHide(request("/api", { body: { reason: " " } }), messageId)).status).toBe(400);
  });

  it.each([["FANPAGE_RATE_LIMITED", 429], ["FANPAGE_IDEMPOTENCY_CONFLICT", 409], ["FANPAGE_FORBIDDEN", 403], ["FANPAGE_NOT_FOUND", 404]])("preserves %s through the existing fanpage error map", async (code, status) => {
    rpc.mockRejectedValueOnce(new Error(code));
    expect((await api.post(request("/api", { body: { body: "hi", idempotencyKey: replyId } }), "elina")).status).toBe(status);
  });

  it("fails closed on malformed RPC output", async () => {
    rpc.mockResolvedValueOnce({ likeCount: 1, total: 1, messages: [{ ...message, email: "secret@example.test" }] });
    expect((await api.read(request("/api", { method: "GET" }), "elina")).status).toBe(503);
    rpc.mockResolvedValueOnce({ likeCount: 1, total: 1, messages: [{ ...message, replyTo: { id: replyId, body: null, nickname: "leaked" } }] });
    expect((await api.read(request("/api", { method: "GET" }), "elina")).status).toBe(503);
  });
});
