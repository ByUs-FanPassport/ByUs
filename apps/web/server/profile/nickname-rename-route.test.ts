import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ProfileRepositoryError } from "./profile-repository";
import { createPutNicknameHandler } from "./profile-route";

function request(nickname: unknown) {
  return new Request("https://byus.kr/api/me/nickname", {
    method: "PUT",
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ nickname }),
  });
}

describe("AUTH-006 nickname rename", () => {
  it("normalizes and updates only the authenticated owner's profile", async () => {
    const renameNickname = vi
      .fn()
      .mockResolvedValue({ completed: true, nickname: "Melody" });
    const response = await createPutNicknameHandler({
      authorize: vi.fn().mockResolvedValue({ appUserId: "owner-1" }),
      repository: { get: vi.fn(), setNickname: vi.fn(), renameNickname },
    })(request("  Ｍｅｌｏｄｙ  "));
    expect(response.status).toBe(200);
    expect(renameNickname).toHaveBeenCalledWith({
      appUserId: "owner-1",
      nickname: "Melody",
    });
    expect(await response.json()).toEqual({
      profile: { completed: true, nickname: "Melody" },
    });
  });

  it.each([
    ["NICKNAME_TAKEN", 409],
    ["NICKNAME_PROHIBITED", 400],
    ["INVALID_NICKNAME", 400],
  ] as const)("maps %s to a stable response", async (code, status) => {
    const response = await createPutNicknameHandler({
      authorize: vi.fn().mockResolvedValue({ appUserId: "owner-1" }),
      repository: {
        get: vi.fn(),
        setNickname: vi.fn(),
        renameNickname: vi
          .fn()
          .mockRejectedValue(new ProfileRepositoryError(code)),
      },
    })(request(code === "NICKNAME_PROHIBITED" ? "Melody" : "Melody2"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });
});
