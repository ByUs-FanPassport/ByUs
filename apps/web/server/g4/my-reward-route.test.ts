import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createMyRewardsHandler } from "./my-reward-route";

describe("My Rewards route", () => {
  it("returns only the authenticated owner's projection with private cache headers", async () => {
    const list = vi.fn(async () => []);
    const response = await createMyRewardsHandler({
      authorize: vi.fn(async () => ({ appUserId: "owner" })),
      repository: { list },
    })(new Request("https://byus.test/api/me/rewards", {
      headers: { authorization: "Bearer token" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    await expect(response.json()).resolves.toEqual({ rewards: [] });
    expect(list).toHaveBeenCalledWith({ appUserId: "owner" });
  });

  it.each([[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"]] as const)(
    "maps authentication status %s without querying rewards",
    async (status, code) => {
      const list = vi.fn(async () => []);
      const response = await createMyRewardsHandler({
        authorize: vi.fn(async () => {
          throw new AuthError("AUTHENTICATION_REQUIRED", status, "denied");
        }),
        repository: { list },
      })(new Request("https://byus.test/api/me/rewards"));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(list).not.toHaveBeenCalled();
    },
  );
});
