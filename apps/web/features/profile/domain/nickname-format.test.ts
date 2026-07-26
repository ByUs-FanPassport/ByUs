import { describe, expect, it } from "vitest";
import { getNicknameFormat } from "./nickname-format";

describe("nickname format contract", () => {
  it("normalizes before trimming and counts the stored value", () => {
    expect(getNicknameFormat("　Ｊｅｗｅｌ＿ＫＡＴ　")).toEqual({
      nickname: "Jewel_KAT",
      normalized: "jewel_kat",
      length: 9,
      valid: true,
    });
  });

  it.each(["John 팬", "fan-name", "fan__name", "fan  name"])(
    "accepts supported internal separators in %j",
    (nickname) => expect(getNicknameFormat(nickname).valid).toBe(true),
  );

  it.each(["a", "a".repeat(17), "fan\tname", "fan\nname", "fan\u200b", "fan\u202e", "가나다🙂"])(
    "rejects unsupported input %j",
    (nickname) => expect(getNicknameFormat(nickname).valid).toBe(false),
  );
});
