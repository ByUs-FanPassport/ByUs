import { describe, expect, it } from "vitest";
import { createKakaoPkce, hashKakaoSubject, safeKakaoReturnPathSchema } from "./kakao-connection";

describe("Kakao connection security", () => {
  it("creates high-entropy, SHA-256 PKCE/state material", () => {
    const first = createKakaoPkce(); const second = createKakaoPkce();
    expect(first.state).not.toBe(second.state);
    expect(first.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(first.codeChallenge).not.toBe(first.codeVerifier);
  });
  it.each(["/my", "/settings?tab=notifications"])("accepts a local safe return path %s", (value) => expect(safeKakaoReturnPathSchema.parse(value)).toBe(value));
  it.each(["https://evil.test", "//evil.test", "/admin"])("rejects unsafe return %s", (value) => expect(() => safeKakaoReturnPathSchema.parse(value)).toThrow());
  it("hashes the stable provider subject", () => expect(hashKakaoSubject("12345")).toMatch(/^[0-9a-f]{64}$/));
});
