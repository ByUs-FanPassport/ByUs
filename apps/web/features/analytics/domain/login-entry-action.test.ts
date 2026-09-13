import { describe, expect, it } from "vitest";
import { classifyLoginEntryAction } from "./login-entry-action";

describe("bounded login entry classification", () => {
  const at = (target: string) => `https://byus.test/login?returnTo=${encodeURIComponent(target)}`;
  it.each([
    ["/elina?locale=ko#daily-checkin", "daily_checkin"],
    ["/ifewknow?locale=en#cheers", "cheer"],
    ["/login#cheers", "other"],
    ["/c/elina?locale=ko#daily-checkin", "daily_checkin"],
    ["/c/ifew?locale=en#cheers", "cheer"],
    ["/s/0123456789abcdef0123456789abcdef?locale=en", "passport_share"],
    ["/my", "other"], ["/c/elina#unknown", "other"],
    ["/my?invite=private-code", "other"],
    ["https://evil.test/c/elina#cheers", "other"],
    ["//evil.test/c/elina#cheers", "other"],
    ["/\\evil.test/c/elina#cheers", "other"],
    ["/s/private-invalid-token", "other"],
  ])("maps %s to only %s", (target, expected) => {
    expect(classifyLoginEntryAction(at(target))).toBe(expected);
  });
  it("ignores targets outside login and invalid URLs", () => {
    expect(classifyLoginEntryAction("not a URL")).toBe("other");
    expect(classifyLoginEntryAction("https://byus.test/my?returnTo=%2Fc%2Felina%23cheers")).toBe("other");
    expect(classifyLoginEntryAction("https://byus.test/login")).toBe("other");
  });
});
