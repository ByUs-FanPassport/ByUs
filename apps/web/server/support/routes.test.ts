import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createSupportHandlers } from "./routes";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const now = "2026-09-11T12:00:00.000Z";
const inquiry = { id, subject: "예약 문의", locale: "ko", status: "open", version: 1, requesterName: "별빛", createdAt: now, updatedAt: now };
const message = { id: other, body: "예약을 확인해주세요", sender: "fan", createdAt: now };
const rpc = vi.fn();
const authorize = vi.fn(async (header: string | null) => {
  if (header !== "Bearer fan") throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Sign in");
  return { appUserId: owner };
});
const authorizeAdmin = vi.fn(async (header: string | null) => {
  if (header !== "Bearer admin") throw new AuthError("ADMIN_NOT_ALLOWLISTED", 403, "Forbidden");
  return { appUserId: other, allowlistId: id, email: "support@example.test", role: "operator" as "operator" | "viewer" };
});
const api = createSupportHandlers({ rpc, authorize, authorizeAdmin });
function request(method = "GET", body?: unknown, token: string | null = "fan", query = "") {
  return new Request(`https://byus.kr/api/me/inquiries${query}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe("CS authority and route contract", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("requires fan authentication for every owned read and write", async () => {
    for (const run of [() => api.list(request("GET", undefined, null)), () => api.detail(request("GET", undefined, "wrong"), id),
      () => api.create(request("POST", {}, null)), () => api.post(request("POST", {}, null), id)]) expect((await run()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects non-admins on all admin endpoints before accessing data", async () => {
    for (const run of [() => api.list(request(), true), () => api.detail(request(), id, true),
      () => api.post(request("POST", {}), id, true), () => api.resolve(request("POST", {}), id)]) expect((await run()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("derives fan identity server-side and stores trimmed allowed fields only", async () => {
    const input = { subject: "  예약 문의  ", body: " 확인 부탁해요 ", locale: "ko", idempotencyKey: id };
    expect((await api.create(request("POST", { ...input, appUserId: other }))).status).toBe(400);
    rpc.mockResolvedValue({ id, replayed: false });
    const response = await api.create(request("POST", input));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("cs_create", { p_app_user_id: owner, p_subject: "예약 문의", p_body: "확인 부탁해요", p_locale: "ko", p_idempotency_key: id });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  });
  it("returns replay success without creating a second client-side operation", async () => {
    rpc.mockResolvedValue({ id, replayed: true });
    const response = await api.create(request("POST", { subject: "Help", body: "Hello", locale: "en", idempotencyKey: id }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ id, replayed: true });
  });
  it("validates filters and keyset cursors without accepting caller actor IDs", async () => {
    rpc.mockResolvedValue({ inquiries: [inquiry], hasMore: true });
    const first = await api.list(request());
    const { nextCursor } = await first.json();
    expect(JSON.parse(Buffer.from(nextCursor, "base64url").toString())).toEqual({ at: now, id });
    expect((await api.list(request("GET", undefined, "admin", `?cursor=${nextCursor}&status=open`), true)).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("cs_list", { p_app_user_id: other, p_admin_allowlist_id: id, p_status: "open", p_before: now, p_before_id: id });
    for (const query of [`?appUserId=${other}`, "?status=open", "?cursor=x", "?cursor=a&cursor=b"]) {
      expect((await api.list(request("GET", undefined, "fan", query))).status).toBe(400);
    }
  });
  it("uses the oldest returned message as the history cursor", async () => {
    rpc.mockResolvedValue({ inquiry, messages: [message], hasMore: true });
    const response = await api.detail(request(), id);
    const data = await response.json();
    expect(JSON.parse(Buffer.from(data.nextCursor, "base64url").toString())).toEqual({ at: now, id: other });
    expect(rpc).toHaveBeenCalledWith("cs_read", { p_app_user_id: owner, p_admin_allowlist_id: null, p_inquiry_id: id, p_before: null, p_before_id: null });
  });
  it("passes only the verified administrator pair and preserves the write correlation", async () => {
    rpc.mockResolvedValue({ id, replayed: false });
    expect((await api.post(request("POST", { body: "안내드려요", idempotencyKey: owner }, "admin"), id, true)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("cs_post", { p_app_user_id: other, p_admin_allowlist_id: id, p_inquiry_id: id, p_body: "안내드려요", p_idempotency_key: owner, p_correlation_id: expect.any(String) });
  });
  it("allows viewer reads but blocks viewer replies and resolution", async () => {
    authorizeAdmin.mockResolvedValueOnce({ appUserId: other, allowlistId: id, email: "viewer@example.test", role: "viewer" });
    rpc.mockResolvedValueOnce({ inquiries: [], hasMore: false });
    expect((await api.list(request("GET", undefined, "admin"), true)).status).toBe(200);
    rpc.mockClear();
    for (const run of [() => api.post(request("POST", { body: "answer", idempotencyKey: owner }, "admin"), id, true),
      () => api.resolve(request("POST", { expectedVersion: 1 }, "admin"), id)]) {
      authorizeAdmin.mockResolvedValueOnce({ appUserId: other, allowlistId: id, email: "viewer@example.test", role: "viewer" });
      expect((await run()).status).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires an integer version for resolution and maps a stale view to conflict", async () => {
    expect((await api.resolve(request("POST", { expectedVersion: "1" }, "admin"), id)).status).toBe(400);
    rpc.mockRejectedValueOnce(new Error("CS_STALE_VERSION"));
    expect((await api.resolve(request("POST", { expectedVersion: 1 }, "admin"), id)).status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("cs_resolve", expect.objectContaining({ p_expected_version: 1 }));
  });
  it.each([["CS_NOT_FOUND", 404], ["CS_FORBIDDEN", 403], ["CS_RATE_LIMITED", 429], ["CS_IDEMPOTENCY_CONFLICT", 409]])("preserves %s without leaking data", async (code, status) => {
    rpc.mockRejectedValueOnce(new Error(code));
    expect((await api.post(request("POST", { body: "hello", idempotencyKey: owner }), id)).status).toBe(status);
  });
  it("fails closed when the DB exposes private fields or the wrong inquiry", async () => {
    rpc.mockResolvedValueOnce({ inquiry: { ...inquiry, appUserId: owner }, messages: [message], hasMore: false });
    expect((await api.detail(request(), id)).status).toBe(503);
    rpc.mockResolvedValueOnce({ inquiry: { ...inquiry, id: other }, messages: [message], hasMore: false });
    expect((await api.detail(request(), id)).status).toBe(503);
    rpc.mockRejectedValueOnce(new Error("connection password private data"));
    const failure = await api.list(request());
    expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("password");
  });
  it("cancels an oversized request stream before parsing or writing", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20_001)); }, cancel });
    const req = new Request("https://byus.kr/api", { method: "POST", headers: { authorization: "Bearer fan" }, body: stream, duplex: "half" } as RequestInit);
    expect((await api.create(req)).status).toBe(413); expect(cancel).toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
});
