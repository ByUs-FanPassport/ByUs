import { describe, expect, it } from "vitest";

import {
  createLiveAttendanceRequestSchema,
  isNormalizedFanCodeValid,
  normalizeFanCode,
  projectAtomicAttendanceResult,
} from "./live-attendance";

describe("live attendance contract", () => {
  it("accepts only a bounded alphanumeric Fan Code and never accepts identity or issuance fields", () => {
    expect(createLiveAttendanceRequestSchema.parse({ code: " KARA 2026 " })).toEqual({ code: " KARA 2026 " });
    for (const value of [
      { code: "" },
      { code: "KARA2026", appUserId: "attacker" },
      { code: "KARA2026", idempotencyKey: crypto.randomUUID() },
    ]) {
      expect(() => createLiveAttendanceRequestSchema.parse(value)).toThrow();
    }
  });

  it("normalizes case and ASCII whitespace while classifying format without persisting the input", () => {
    expect(normalizeFanCode(" ka ra\t2026 ")).toBe("KARA2026");
    expect(isNormalizedFanCodeValid("KARA2026")).toBe(true);
    expect(isNormalizedFanCodeValid("A")).toBe(false);
    expect(isNormalizedFanCodeValid("KARA-2026")).toBe(false);
  });

  it("projects the atomic result into an owner-safe attendance summary", () => {
    expect(projectAtomicAttendanceResult({
      attendanceId: "11111111-1111-4111-8111-111111111111",
      liveEventId: "22222222-2222-4222-8222-222222222222",
      passportId: "33333333-3333-4333-8333-333333333333",
      activityId: "44444444-4444-4444-8444-444444444444",
      stampId: "55555555-5555-4555-8555-555555555555",
      attendedAt: "2026-07-21T12:00:00.000Z",
      scorePoints: 3,
      stampMintStatus: "queued",
    })).toEqual({
      attendance: {
        id: "11111111-1111-4111-8111-111111111111",
        liveEventId: "22222222-2222-4222-8222-222222222222",
        attendedAt: "2026-07-21T12:00:00.000Z",
        scorePoints: 3,
        stamp: {
          id: "55555555-5555-4555-8555-555555555555",
          businessStatus: "issued",
          mintStatus: "queued",
        },
      },
    });
  });

  it("rejects a malformed or over-broad database projection", () => {
    expect(() => projectAtomicAttendanceResult({ code: "KARA2026" })).toThrow();
  });
});
