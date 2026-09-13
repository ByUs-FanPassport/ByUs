import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHomeBannerManagerHandlers } from "./home-banner-manager-route";
import type { HomeBannerManagerDependencies } from "./home-banner-manager-route-dependencies";

function make(role: "admin" | "viewer" = "admin") {
  return {
    authorize: vi.fn().mockResolvedValue({ appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222", email: "a@test", role }),
    repository: { read: vi.fn().mockResolvedValue({ items: [], celebrities: [] }), command: vi.fn().mockResolvedValue({ updated: 1 }) },
    invalidatePublicContent: vi.fn(),
  } satisfies HomeBannerManagerDependencies;
}
function request(body?: unknown) { return new Request("http://local/api/admin/home-banners", { method: body ? "POST" : "GET", headers: { authorization: "Bearer token", "content-type": "application/json", "x-correlation-id": "33333333-3333-4333-8333-333333333333" }, body: body ? JSON.stringify(body) : undefined }); }
describe("home banner manager route", () => {
  it("returns the exact manager projection privately", async () => {
    const d = make(); const response = await createHomeBannerManagerHandlers(d).GET(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ items: [], celebrities: [] });
  });
  it("keeps viewers read-only", async () => {
    const d = make("viewer"); const response = await createHomeBannerManagerHandlers(d).POST(request({ action: "reorder", items: [] }));
    expect(response.status).toBe(403); expect(d.repository.command).not.toHaveBeenCalled(); expect(d.invalidatePublicContent).not.toHaveBeenCalled();
  });
  it("validates mutations and invalidates after success", async () => {
    const d = make(); const response = await createHomeBannerManagerHandlers(d).POST(request({ action: "reorder", items: [] }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ items: [], celebrities: [] });
    expect(d.repository.command).toHaveBeenCalled(); expect(d.repository.read).toHaveBeenCalled(); expect(d.invalidatePublicContent).toHaveBeenCalledOnce();
  });
  it("maps stale revisions to conflict and does not invalidate", async () => {
    const d = make(); d.repository.command.mockRejectedValue(new Error("revision conflict"));
    const response = await createHomeBannerManagerHandlers(d).POST(request({ action: "reorder", items: [] }));
    expect(response.status).toBe(409); expect(d.invalidatePublicContent).not.toHaveBeenCalled();
  });
  it("maps malformed and oversized JSON to bounded client errors", async () => {
    const d = make();
    const malformed = new Request("http://local/api/admin/home-banners", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: "{" });
    expect((await createHomeBannerManagerHandlers(d).POST(malformed)).status).toBe(400);
    const oversized = new Request("http://local/api/admin/home-banners", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json", "content-length": "128001" }, body: "{}" });
    expect((await createHomeBannerManagerHandlers(d).POST(oversized)).status).toBe(413);
    expect(d.repository.command).not.toHaveBeenCalled();
  });
});
