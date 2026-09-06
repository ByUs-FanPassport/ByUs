import { describe, expect, it } from "vitest";
import { fanProfileSchema, normalizeNickname } from "./profile";

describe("FAN-005 profile domain", () => {
  it.each(["KARAFan", "KARA짱", "KATSEYEFan", "캣츠아이팬", "카라💜팬"])("allows fan expression %j", (nickname) => {
    expect(normalizeNickname(nickname).nickname).toBe(nickname);
  });

  it.each(["a.d.m.i.n", "of\u200dficial", "f.u.c.k", "K.A.R.A", "KAT💜SEYE"])("retains reserved-name protection for %j", (name) => {
    expect(() => normalizeNickname(name)).toThrowError(expect.objectContaining({ reason: "prohibited" }));
  });

  it.each(["雨", "👨‍👩‍👧‍👦".repeat(32), "عائشة", "ก้อย"])("reads a saved global name %j", (nickname) => {
    expect(fanProfileSchema.safeParse({ completed: true, nickname }).success).toBe(true);
  });
  it("trims, applies NFKC, and derives a case-insensitive uniqueness key", () => {
    expect(normalizeNickname("  Ｆａｎ１２  ")).toEqual({ nickname: "Fan12", normalized: "fan12" });
  });

  it.each([
    ["Jewel_KAT", "jewel_kat"],
    ["John 팬", "john 팬"],
    ["fan-name", "fan-name"],
  ])("accepts supported separators in %j", (nickname, normalized) => {
    expect(normalizeNickname(nickname)).toEqual({ nickname, normalized });
  });

  it.each(["", "a".repeat(33), "fan\tname", "fan\nname", "fan\u200b", "fan\u202e"])(
    "rejects invalid or abnormal nickname %j",
    (nickname) => expect(() => normalizeNickname(nickname)).toThrowError(expect.objectContaining({ reason: "invalid" })),
  );

  it.each(["ByUsFan", "By_Us", "KARA", "KATSEYE", "KAT_SEYE", "캣츠아이", "관리자1", "officialFan", "씨발팬"])(
    "rejects prohibited nickname %j",
    (nickname) => expect(() => normalizeNickname(nickname)).toThrowError(expect.objectContaining({ reason: "prohibited" })),
  );

  it("requires completion and nickname presence to agree", () => {
    expect(fanProfileSchema.safeParse({ completed: false, nickname: null }).success).toBe(true);
    expect(fanProfileSchema.safeParse({ completed: true, nickname: "Fan12" }).success).toBe(true);
    expect(fanProfileSchema.safeParse({ completed: true, nickname: null }).success).toBe(false);
  });
});
