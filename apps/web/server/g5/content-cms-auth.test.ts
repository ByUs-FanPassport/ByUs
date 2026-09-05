import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { celebrityHandlers, quizHandlers, type CmsRouteDeps } from "./content-cms-route";

vi.mock("server-only", () => ({}));

describe("content CMS authentication failures", () => {
  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["INVALID_PRIVY_IDENTITY", 401],
    ["ADMIN_NOT_ALLOWLISTED", 403],
    ["ADMIN_DISABLED", 403],
  ] as const)("preserves %s on reads and writes without accessing content", async (code, status) => {
    const access = vi.fn();
    const deps: CmsRouteDeps = {
      authorize: vi.fn().mockRejectedValue(new AuthError(code, status, "Private diagnostic")),
      repository: new Proxy({}, { get: access }) as CmsRouteDeps["repository"],
      invalidatePublicContent: vi.fn(),
    };
    for (const method of ["GET", "POST"] as const) {
      const request = () => new Request("https://byus.test/api/admin/celebrities", { method });
      const responses = [
        await celebrityHandlers(deps)[method](request()),
        await quizHandlers(deps)[method](request(), "creator-id"),
      ];
      for (const response of responses) {
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: code });
      }
    }
    expect(access).not.toHaveBeenCalled();
    expect(deps.invalidatePublicContent).not.toHaveBeenCalled();
  });
});
