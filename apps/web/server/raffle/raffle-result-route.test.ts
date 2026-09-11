import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createGetOwnedRaffleResultHandler, createGetOwnedRafflesHandler, type RaffleResultRouteDependencies } from "./raffle-result-route";

vi.mock("server-only", () => ({}));

const benefitId = "10000000-0000-4000-8000-000000000001";
function deps(): RaffleResultRouteDependencies {
  return { authorize: vi.fn().mockResolvedValue({ appUserId: "verified-owner" }),
    repository: { find: vi.fn().mockResolvedValue(null), list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) } };
}
describe("owner raffle routes", () => {
  it("uses verified owner rather than query identity and disables caching", async () => {
    const d = deps();
    const response = await createGetOwnedRafflesHandler(d)(new Request("https://byus.test/api/me/raffles?locale=en&appUserId=another-owner"));
    expect(response.status).toBe(200);
    expect(d.repository.list).toHaveBeenCalledWith({ appUserId: "verified-owner", locale: "en", cursor: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not report a database failure as not selected", async () => {
    const d = deps(); vi.mocked(d.repository.find).mockRejectedValue(new Error("database unavailable"));
    const response = await createGetOwnedRaffleResultHandler(d)(new Request("https://byus.test/result"), { benefitId });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "RAFFLE_RESULT_UNAVAILABLE" } });
  });
  it("never calls the repository on an authentication failure", async () => {
    const d = deps(); vi.mocked(d.authorize).mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "Sign in required"));
    const response = await createGetOwnedRafflesHandler(d)(new Request("https://byus.test/api/me/raffles"));
    expect(response.status).toBe(401); expect(d.repository.list).not.toHaveBeenCalled();
  });
  it("rejects malformed locale/cursor without interpreting empty data", async () => {
    const d = deps();
    const response = await createGetOwnedRafflesHandler(d)(new Request("https://byus.test/api/me/raffles?locale=xx"));
    expect(response.status).toBe(400); expect(d.repository.list).not.toHaveBeenCalled();
  });
});
