import { describe, expect, it } from "vitest";

import { appendLiveReturnTo, sanitizeLiveReturnTo } from "./live-return-context";

describe("LIVE return context", () => {
  it("canonicalizes a LIVE detail target and preserves its reservation auth intent", () => {
    expect(sanitizeLiveReturnTo(
      "/live/kara-seoul?authIntent=ABCDEFAB-1234-4123-8123-ABCDEFABCDEF&locale=ko",
    )).toBe("/live/kara-seoul?locale=ko&authIntent=abcdefab-1234-4123-8123-abcdefabcdef");
  });

  it.each([
    "https://evil.example/live/kara?locale=ko",
    "//evil.example/live/kara?locale=ko",
    "/\\evil.example/live/kara?locale=ko",
    "/live/kara%5C@evil.example?locale=ko",
    "/live/kara?locale=ko%0a",
    "/live/kara?locale=ko&next=/passports",
    "/live/kara?locale=ko&locale=en",
    "/live/kara?locale=ja",
    "/live/calendar?locale=ko",
    "/c/kara/verify?locale=ko",
    "/passports/id/issuance?locale=ko",
  ])("rejects an unsafe or looping return target: %s", (target) => {
    expect(sanitizeLiveReturnTo(target)).toBeNull();
  });

  it("adds only a validated target to the next verification route", () => {
    expect(appendLiveReturnTo(
      "/c/kara/verify/questions?attempt=attempt-id&locale=ko",
      "/live/kara-seoul?locale=ko",
    )).toBe(
      "/c/kara/verify/questions?attempt=attempt-id&locale=ko&returnTo=%2Flive%2Fkara-seoul%3Flocale%3Dko",
    );
    expect(appendLiveReturnTo("/c/kara/verify?locale=ko", "//evil.example/live/kara?locale=ko"))
      .toBe("/c/kara/verify?locale=ko");
  });
});
