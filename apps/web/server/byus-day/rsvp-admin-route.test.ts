import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createRsvpAdminHandler } from "./rsvp-admin-route";

const id = "10000000-0000-4000-8000-000000000001";
const actor = { appUserId: id, allowlistId: id, email: "admin@example.com", role: "admin" as const };
const attendee = { id, koreanName: "김가온", englishName: "Gaon Kim", affiliation: "ByUs", occupation: "매니저", phone: "+821000000001", email: "gaon@example.com", nationality: "KR", createdAt: "2026-10-07T04:00:00.123456+00:00" };
const deps = { authorizeAdmin: vi.fn(), rpc: vi.fn() };
const handler = createRsvpAdminHandler(deps);
const request = () => new Request("https://byus.kr/api/admin/byus-day-rsvps", { headers: { authorization: "Bearer token" } });

beforeEach(() => {
  vi.resetAllMocks();
  deps.authorizeAdmin.mockResolvedValue(actor);
  deps.rpc.mockResolvedValue({ attendees: [attendee] });
});

describe("ByUs Day admin attendee read", () => {
  it.each(["admin", "operator", "viewer"])("allows the existing %s read role and returns only the attendee projection without caching", async role => {
    deps.authorizeAdmin.mockResolvedValue({ ...actor, role });
    deps.rpc.mockResolvedValue({ attendees: [{ ...attendee, resident_registration_number_encrypted: "private", ip_hash: "private" }], internal: "private" });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(await response.json()).toEqual({ attendees: [attendee] });
    expect(deps.authorizeAdmin).toHaveBeenCalledWith("Bearer token", expect.any(String));
    expect(deps.rpc).toHaveBeenCalledWith("list_admin_byus_day_rsvps", { p_actor_app_user_id: id, p_actor_admin_allowlist_id: id });
  });
  it.each([401, 403] as const)("rejects unauthorized access (%s) before reading registrations", async status => {
    deps.authorizeAdmin.mockRejectedValue(new AuthError("ADMIN_DISABLED", status, "private identity"));
    const response = await handler(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private");
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied actor parameters", async () => {
    const response = await handler(new Request(`${request().url}?p_actor_app_user_id=${id}`));
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("fails closed if database authorization is revoked", async () => {
    deps.rpc.mockRejectedValue(new Error("RSVP_ADMIN_FORBIDDEN"));
    expect((await handler(request())).status).toBe(403);
  });
  it("does not expose database errors or malformed responses", async () => {
    for (const value of [new Error("private SQL details"), { attendees: [{ ...attendee, email: "broken" }] }]) {
      if (value instanceof Error) deps.rpc.mockRejectedValueOnce(value); else deps.rpc.mockResolvedValueOnce(value);
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "RSVP_ADMIN_UNAVAILABLE" } });
    }
  });
});
