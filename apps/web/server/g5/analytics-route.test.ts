import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { AnalyticsRepositoryError, type AnalyticsRepository } from "./analytics-repository";
import { createGetBrandAnalyticsHandler, createGetCreatorAnalyticsHandler } from "./analytics-route";

const adminId = "11111111-1111-4111-8111-111111111111";
const scopeId = "22222222-2222-4222-8222-222222222222";
const query = `from=${encodeURIComponent("2026-07-01T00:00:00Z")}&to=${encodeURIComponent("2026-08-01T00:00:00Z")}&asOf=${encodeURIComponent("2026-08-01T00:00:00Z")}`;
function deps(repository?: Partial<AnalyticsRepository>) {
  return { authorize: vi.fn(async () => ({ email: "ops@byus.test", role: "operator" as const, appUserId: adminId, allowlistId: adminId })), repository: { readCreator: vi.fn(async () => ({} as never)), readBrand: vi.fn(async () => ({} as never)), ...repository } as AnalyticsRepository };
}

describe("ADM-008/009 analytics HTTP boundary", () => {
  it("requires canonical filters before authorization and rejects duplicates/unknowns", async () => {
    for (const url of ["?", `?celebrity=${scopeId}&${query}&from=2026-01-01T00:00:00Z`, `?celebrity=${scopeId}&${query}&appUserId=${adminId}`, `?celebrity=${scopeId}&from=2026-08-01T00:00:00Z&to=2026-07-01T00:00:00Z&asOf=2026-08-01T00:00:00Z`]) {
      const d = deps(); const response = await createGetCreatorAnalyticsHandler(d)(new Request(`https://byus.test/api/admin/analytics/creator${url}`));
      expect(response.status).toBe(400); expect(d.authorize).not.toHaveBeenCalled();
    }
  });

  it("authorizes, forwards normalized creator scope, and disables shared caches", async () => {
    const d = deps();
    const response = await createGetCreatorAnalyticsHandler(d)(new Request(`https://byus.test/api/admin/analytics/creator?celebrity=${scopeId}&${query}`, { headers: { authorization: "Bearer token" } }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(d.repository.readCreator).toHaveBeenCalledWith(expect.objectContaining({ adminAllowlistId: adminId, celebrityId: scopeId, from: "2026-07-01T00:00:00.000Z" }));
  });

  it("maps auth and data failures to generic private errors", async () => {
    const denied = deps(); denied.authorize.mockRejectedValue(new AuthError("ADMIN_NOT_ALLOWLISTED", 403, "private"));
    expect((await createGetBrandAnalyticsHandler(denied)(new Request(`https://byus.test/api/admin/analytics/brand?brand=${scopeId}&${query}`))).status).toBe(403);
    const unavailableData = deps({ readBrand: vi.fn(async () => { throw new AnalyticsRepositoryError(); }) });
    const response = await createGetBrandAnalyticsHandler(unavailableData)(new Request(`https://byus.test/api/admin/analytics/brand?brand=${scopeId}&${query}`));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: { code: "ANALYTICS_UNAVAILABLE" } });
  });
});
