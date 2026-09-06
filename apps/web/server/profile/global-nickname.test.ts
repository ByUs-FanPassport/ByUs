import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPostNicknameHandler, createPutNicknameHandler } from "./profile-route";
import { SupabaseProfileRepository } from "./profile-repository";
import { SupabaseSettingsRepository } from "./settings-repository";
import { basePassportSchema } from "../../features/passport/domain/passport-read-model";
import { stampDetailRecordSchema } from "../../features/passport/domain/stamp-detail";

const supported = ["雨", "화이팅!", "さくら", "عائشة", "ก้อย", "José", "KARAFan", "👨‍👩‍👧‍👦".repeat(32)];

describe.each([
  ["POST", createPostNicknameHandler, "setNickname"],
  ["PUT", createPutNicknameHandler, "renameNickname"],
] as const)("%s global display-name boundary", (method, createHandler, operation) => {
  it.each(supported)("persists %j for the authenticated owner", async (nickname) => {
    const persist = vi.fn().mockResolvedValue({ completed: true, nickname });
    const repository = { get: vi.fn(), setNickname: persist, renameNickname: persist };
    const response = await createHandler({
      authorize: vi.fn().mockResolvedValue({ appUserId: "owner-1" }), repository,
    })(new Request("https://byus.kr/api/me/nickname", {
      method, body: JSON.stringify({ nickname }),
    }));
    expect(response.status).toBe(200);
    expect(repository[operation]).toHaveBeenCalledExactlyOnceWith({ appUserId: "owner-1", nickname });
    expect(await response.json()).toEqual({ profile: { completed: true, nickname } });
  });

  it.each(["", "a".repeat(33), "👨‍👩‍👧‍👦".repeat(33), "fan\u202e", "fan\u2028name", "a" + "\u0301".repeat(600)])(
    "rejects invalid input before DB access %j", async (nickname) => {
      const persist = vi.fn();
      const response = await createHandler({
        authorize: vi.fn().mockResolvedValue({ appUserId: "owner-1" }),
        repository: { get: vi.fn(), setNickname: persist, renameNickname: persist },
      })(new Request("https://byus.kr/api/me/nickname", { method, body: JSON.stringify({ nickname }) }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "INVALID_NICKNAME" } });
      expect(persist).not.toHaveBeenCalled();
    },
  );
});

describe("saved global display names remain readable", () => {
  it.each(supported)("reads %j through profile, settings, Passport and Stamp", async (nickname) => {
    const dto = { completed: true, nickname };
    const profile = new SupabaseProfileRepository({ rpc: vi.fn().mockResolvedValue({ data: dto, error: null }) });
    await expect(profile.get("owner-1")).resolves.toEqual(dto);
    const query = (data: unknown) => {
      const builder = {
        select: vi.fn(() => builder), eq: vi.fn(() => builder), order: vi.fn(() => builder),
        limit: vi.fn(() => builder), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      };
      return builder;
    };
    const settings = new SupabaseSettingsRepository({ from: (table) => query(table === "user_profiles" ? { nickname } : null) });
    await expect(settings.get("owner-1")).resolves.toEqual({ nickname, wallet: null });
    expect(basePassportSchema.shape.owner.parse({ nickname })).toEqual({ nickname });
    expect(stampDetailRecordSchema.shape.owner.parse({ nickname })).toEqual({ nickname });
  });
});
