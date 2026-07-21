import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createGetSettingsHandler } from "./settings-route";

describe("FAN-020 settings route", () => {
  it("returns only nickname and a masked wallet summary", async () => {
    const repository = {
      get: vi.fn().mockResolvedValue({
        nickname: "Kamilia",
        wallet: { chainId: 91342, maskedAddress: "0x1234…cdef" },
      }),
    };
    const response = await createGetSettingsHandler({
      authorize: vi.fn().mockResolvedValue({ appUserId: "user-1" }),
      repository,
    })(
      new Request("https://byus.kr/api/me/settings", {
        headers: { authorization: "Bearer valid" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      settings: {
        nickname: "Kamilia",
        wallet: { chainId: 91342, maskedAddress: "0x1234…cdef" },
      },
    });
  });

  it("rejects unauthenticated requests without consulting storage", async () => {
    const repository = { get: vi.fn() };
    const response = await createGetSettingsHandler({
      authorize: vi
        .fn()
        .mockRejectedValue(
          new AuthError("AUTHENTICATION_REQUIRED", 401, "required"),
        ),
      repository,
    })(new Request("https://byus.kr/api/me/settings"));
    expect(response.status).toBe(401);
    expect(repository.get).not.toHaveBeenCalled();
  });
});
