import { describe, expect, it } from "vitest";
import { getNicknameFormat, getNicknameFormatMessage } from "./nickname-format";

describe("nickname format contract", () => {
  it.each(["화이팅!", "さくら", "小雨", "ก้อย", "عائشة", "José", "é", "ㅋㅋ", "민지💜", "👨‍👩‍👧‍👦", "می‌خواهم", "฿", "𝄞", "🫩"])(
    "supports global display names %j", (name) => expect(getNicknameFormat(name).valid).toBe(true),
  );

  it("counts composed accents and joined emoji by visible grapheme", () => {
    expect(getNicknameFormat("e\u0301")).toMatchObject({ nickname: "é", length: 1, valid: true });
    expect(getNicknameFormat("👨‍👩‍👧‍👦".repeat(32))).toMatchObject({ length: 32, valid: true });
    expect(getNicknameFormat("👨‍👩‍👧‍👦".repeat(33))).toMatchObject({ length: 33, reason: "too_long" });
  });

  it.each(["\u200b", "\u2060", "\u202e", "\u061c", "\u3164", "\u00ad"])(
    "rejects hidden or directional controls %j", (char) => {
      expect(getNicknameFormat(`fan${char}`)).toMatchObject({ valid: false, reason: "unsupported" });
    },
  );

  it.each(["\n", "\r", "\u2028", "\u2029"])("identifies line separators %j", (char) => {
    expect(getNicknameFormat(`fan${char}name`).reason).toBe("newline");
  });

  it.each(["  ", "\u0301", "\u200d", "\ufe0f"])("requires a visible base in %j", (name) => {
    expect(getNicknameFormat(name)).toMatchObject({ valid: false, reason: "empty" });
  });

  it("rejects pathological combining runs below the database index limit", () => {
    expect(getNicknameFormat("a" + "\u0301".repeat(600))).toMatchObject({ length: 1, valid: false, reason: "unsupported" });
  });

  it.each([["İ", "i\u0307"], ["ΟΣ", "ος"], ["É", "é"], ["ẞ", "ß"]])(
    "uses Unicode lowercase for %s", (name, normalized) => {
      expect(getNicknameFormat(name).normalized).toBe(normalized);
    },
  );

  it("provides actionable messages without claiming server availability", () => {
    expect(getNicknameFormatMessage("too_long", "ko")).toContain("32자");
    expect(getNicknameFormatMessage("empty", "en")).toBe("Enter a display name.");
    expect(getNicknameFormatMessage(null, "ko")).toBe("");
  });
  it("normalizes before trimming and counts the stored value", () => {
    expect(getNicknameFormat("　Ｊｅｗｅｌ＿ＫＡＴ　")).toEqual({
      nickname: "Jewel_KAT",
      normalized: "jewel_kat",
      length: 9,
      valid: true,
      reason: null,
    });
  });

  it.each(["John 팬", "fan-name", "fan__name", "fan  name"])(
    "accepts supported internal separators in %j",
    (nickname) => expect(getNicknameFormat(nickname).valid).toBe(true),
  );

  it.each(["", "a".repeat(33), "fan\tname", "fan\nname", "fan\u200b", "fan\u202e"])(
    "rejects unsupported input %j",
    (nickname) => expect(getNicknameFormat(nickname).valid).toBe(false),
  );
});
