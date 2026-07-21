import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ProfileRepositoryError, SupabaseProfileRepository } from "./profile-repository";

describe("SupabaseProfileRepository", () => {
  it("reads and creates only the minimal owner profile DTO", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { completed: false, nickname: null }, error: null })
      .mockResolvedValueOnce({ data: { completed: true, nickname: "Fan12" }, error: null });
    const repository = new SupabaseProfileRepository({ rpc });

    await expect(repository.get("user-1")).resolves.toEqual({ completed: false, nickname: null });
    await expect(repository.setNickname({ appUserId: "user-1", nickname: "Fan12" }))
      .resolves.toEqual({ completed: true, nickname: "Fan12" });
    expect(rpc).toHaveBeenNthCalledWith(1, "get_owned_user_profile", { p_app_user_id: "user-1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "set_owned_user_nickname", { p_app_user_id: "user-1", p_nickname: "Fan12" });
  });

  it.each([
    ["FAN005_INVALID_NICKNAME", "INVALID_NICKNAME"],
    ["FAN005_NICKNAME_PROHIBITED", "NICKNAME_PROHIBITED"],
    ["FAN005_NICKNAME_TAKEN", "NICKNAME_TAKEN"],
    ["FAN005_PROFILE_ALREADY_COMPLETED", "PROFILE_ALREADY_COMPLETED"],
  ] as const)("maps %s without exposing database text", async (message, code) => {
    const repository = new SupabaseProfileRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }) });
    await expect(repository.setNickname({ appUserId: "user-1", nickname: "Fan12" }))
      .rejects.toEqual(new ProfileRepositoryError(code));
  });
});
