import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createParticipationHandler } from "./routes";
const owner = "10000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000002";
const rpc = vi.fn(), authorize = vi.fn(async (value: string | null) => { if (value !== "Bearer valid") throw new AuthError("AUTHENTICATION_REQUIRED",401,"invalid"); return { appUserId: owner }; });
const authorizeAdmin = vi.fn(async (_authorization: string | null, _correlationId: string) => ({ appUserId: owner, allowlistId: id, role: "operator" as "operator" | "viewer", email: "admin@example.test" }));
const run = createParticipationHandler({ rpc, authorize, authorizeAdmin });
const request = (path: string, body?: unknown, authenticated = false, method = body === undefined ? "GET" : "POST") => new Request(`https://byus.example${path}`, { method, headers: { ...(authenticated ? { authorization: "Bearer valid" } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
beforeEach(() => { rpc.mockReset(); authorize.mockClear(); authorizeAdmin.mockClear(); });
it("rejects supplied invalid sessions on public reads rather than downgrading", async () => {
  const result = await run("schedules", new Request("https://byus.example/api/schedules?month=2026-09", { headers: { authorization: "Bearer invalid" } }));
  expect(result.status).toBe(401); expect(rpc).not.toHaveBeenCalled();
});
it("takes subscription owner only from auth and rejects extra input fields", async () => {
  expect((await run("subscription", request("/api", { subscribed: true, appUserId: id }, true, "PUT"), { id })).status).toBe(422);
  expect(rpc).not.toHaveBeenCalled(); rpc.mockResolvedValue({ scheduleId: id, subscribed: true });
  const result = await run("subscription", request("/api", { subscribed: true }, true, "PUT"), { id });
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(rpc).toHaveBeenCalledWith("fan_web_set_schedule_subscription", { p_app_user_id: owner, p_schedule_id: id, p_subscribed: true });
});
it("encodes ordered pagination and preserves month/artist bounds", async () => {
  rpc.mockResolvedValue({ items: [], nextCursor: { at: "2026-09-01T00:00:00Z", id } });
  const result = await run("schedules", request("/api?month=2026-09&celebritySlug=artist-one"));
  expect(result.status).toBe(200); const data = await result.json(); expect(JSON.parse(Buffer.from(data.nextCursor, "base64url").toString())).toEqual({ at: "2026-09-01T00:00:00Z", id });
  expect(rpc).toHaveBeenLastCalledWith("fan_web_list_schedules", expect.objectContaining({ p_app_user_id: null, p_celebrity_slug: "artist-one", p_limit: 100, p_starts_at: "2026-08-31T15:00:00.000Z" }));
});
it("keeps viewer writes out of RPC and uses one correlated server actor for mutations", async () => {
  authorizeAdmin.mockResolvedValueOnce({ appUserId: owner, allowlistId: id, role: "viewer", email: "admin@example.test" });
  expect((await run("admin-live-settings", request("/api", {}, true, "PUT"), { id })).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ accepting: false, closesAt: null, visibility: "public", revision: 1 });
  expect((await run("admin-live-settings", request("/api", { expectedRevision: 0, accepting: false, closesAt: null, visibility: "public" }, true, "PUT"), { id })).status).toBe(200);
  expect(rpc.mock.calls[0][1].p_correlation_id).toBe(authorizeAdmin.mock.calls[1]?.[1]);
});
it("returns stable deadline errors and hides RPC details", async () => {
  rpc.mockRejectedValueOnce(new Error("db: FAN_WEB_CLOSED secret"));
  const result = await run("live-submissions", request("/api", { kind: "question", body: "Hello", idempotencyKey: id }, true), { slug: "event" });
  expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: { code: "FAN_WEB_CLOSED" } });
  rpc.mockRejectedValueOnce(new Error("database password"));
  const fail = await run("schedule", request("/api"), { id }); expect(fail.status).toBe(503); expect(await fail.text()).not.toContain("password");
});
it("rejects oversized JSON before writes and invalid opaque cursors", async () => {
  expect((await run("requests", request("/api", { note: "a".repeat(17000) }, true))).status).toBe(413);
  expect((await run("suggestions", request("/api?cursor=%%", undefined, true))).status).toBe(422); expect(rpc).not.toHaveBeenCalled();
});
it("treats malformed server projections as unavailable without leaking internal fields", async () => {
  rpc.mockResolvedValueOnce({ items: [], nextCursor: null, appUserId: owner });
  const result = await run("suggestions", request("/api", undefined, true));
  expect(result.status).toBe(503); expect(await result.text()).not.toContain(owner);
});
