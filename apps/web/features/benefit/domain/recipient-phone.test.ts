import { describe, expect, it } from "vitest";

import { normalizeRecipientPhone } from "./recipient-phone";

describe("normalizeRecipientPhone", () => {
  it.each([
    ["KR", "010-1234-5678", "+821012345678", "5678"],
    ["US", "(213) 373-4253", "+12133734253", "4253"],
    ["JP", "090-1234-5678", "+819012345678", "5678"],
  ] as const)("normalizes a valid %s number to E.164", (country, input, e164, last4) => {
    expect(normalizeRecipientPhone(country, input)).toEqual({ country, e164, last4 });
  });

  it.each([
    ["KR", "1234"],
    ["KR", "+1 213 373 4253"],
    ["US", "+81 90 1234 5678"],
    ["KR", "010-1234-5678 ext. 12"],
  ] as const)("rejects an invalid or mismatched %s number", (country, input) => {
    expect(() => normalizeRecipientPhone(country, input)).toThrow("INVALID_RECIPIENT_PHONE");
  });
});
