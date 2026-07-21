import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { ProfileRepositoryError } from "./profile-repository";
import { createGetProfileHandler, createPostNicknameHandler } from "./profile-route";

const request = (method: "GET" | "POST", body?: unknown) => new Request("https://byus.example/api/me/profile", {
  method,
  headers: { authorization: "Bearer token", ...(body === undefined ? {} : { "content-type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe("FAN-005 profile routes", () => {
  it("returns only the authenticated owner's minimal completion state", async () => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue({ appUserId: "user-1" }),
      repository: { get: vi.fn().mockResolvedValue({ completed: false, nickname: null }), setNickname: vi.fn() },
    };
    const response = await createGetProfileHandler(dependencies)(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: { completed: false, nickname: null } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.repository.get).toHaveBeenCalledWith("user-1");
  });

  it("normalizes a valid first-set nickname before persistence", async () => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue({ appUserId: "user-1" }),
      repository: { get: vi.fn(), setNickname: vi.fn().mockResolvedValue({ completed: true, nickname: "Fan12" }) },
    };
    const response = await createPostNicknameHandler(dependencies)(request("POST", { nickname: "  Ｆａｎ１２  " }));
    expect(response.status).toBe(200);
    expect(dependencies.repository.setNickname).toHaveBeenCalledWith({ appUserId: "user-1", nickname: "Fan12" });
    expect(await response.json()).toEqual({ profile: { completed: true, nickname: "Fan12" } });
  });

  it.each([
    [{ nickname: "fan name" }, "INVALID_NICKNAME"],
    [{ nickname: "KARAFan" }, "NICKNAME_PROHIBITED"],
    [{ nickname: "fan", extra: true }, "INVALID_NICKNAME"],
  ] as const)("rejects invalid body %o with %s", async (body, code) => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue({ appUserId: "user-1" }),
      repository: { get: vi.fn(), setNickname: vi.fn() },
    };
    const response = await createPostNicknameHandler(dependencies)(request("POST", body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code } });
    expect(dependencies.repository.setNickname).not.toHaveBeenCalled();
  });

  it.each([
    [new ProfileRepositoryError("NICKNAME_TAKEN"), 409, "NICKNAME_TAKEN"],
    [new ProfileRepositoryError("PROFILE_ALREADY_COMPLETED"), 409, "PROFILE_ALREADY_COMPLETED"],
    [new ProfileRepositoryError("PROFILE_INTEGRITY_ERROR"), 503, "PROFILE_UNAVAILABLE"],
  ] as const)("maps persistence failures", async (error, status, code) => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue({ appUserId: "user-1" }),
      repository: { get: vi.fn(), setNickname: vi.fn().mockRejectedValue(error) },
    };
    const response = await createPostNicknameHandler(dependencies)(request("POST", { nickname: "Fan12" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });

  it("requires a canonical authenticated owner", async () => {
    const response = await createGetProfileHandler({
      authorize: vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "required")),
      repository: { get: vi.fn(), setNickname: vi.fn() },
    })(request("GET"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });
});
