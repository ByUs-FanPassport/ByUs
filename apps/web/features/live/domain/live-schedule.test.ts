import { describe, expect, it } from "vitest";

import {
  kstDateTimeLocalToInstant,
  liveScheduleRevisionSchema,
  toKstDateTimeLocal,
} from "./live-schedule";

const revision = {
  liveEventId: "33333333-3333-4333-8333-333333333333",
  expectedRevision: 2,
  reason: "Artist travel requires a later broadcast window",
  reservationOpensAt: "2026-09-09T01:00:00.000Z",
  reservationClosesAt: "2026-09-10T09:00:00.000Z",
  startsAt: "2026-09-10T10:00:00.000Z",
  endsAt: "2026-09-10T11:00:00.000Z",
  attendanceValidFrom: "2026-09-10T09:55:00.000Z",
  attendanceValidUntil: "2026-09-10T11:05:00.000Z",
};

describe("Phase 3 LIVE schedule revision domain", () => {
  it.each([
    ["reservationOpensAt", "2026-09-09T01:00:00.000Z", "2026-09-09T10:00"],
    ["reservationClosesAt", "2026-09-10T09:00:00.000Z", "2026-09-10T18:00"],
    ["startsAt", "2026-09-10T10:00:00.000Z", "2026-09-10T19:00"],
    ["endsAt", "2026-09-10T11:00:00.000Z", "2026-09-10T20:00"],
    ["attendanceValidFrom", "2026-09-10T09:55:00.000Z", "2026-09-10T18:55"],
    ["attendanceValidUntil", "2026-09-10T11:05:00.000Z", "2026-09-10T20:05"],
    ["overrideEffectiveFrom", "2026-09-10T10:05:00.000Z", "2026-09-10T19:05"],
    ["overrideEffectiveUntil", "2026-09-10T10:55:00.000Z", "2026-09-10T19:55"],
  ])("round-trips %s explicitly as an Asia/Seoul wall clock", (_field, instant, local) => {
    expect(toKstDateTimeLocal(instant)).toBe(local);
    expect(kstDateTimeLocalToInstant(local)).toBe(instant);
  });

  it("accepts a complete audited optimistic revision payload", () => {
    expect(liveScheduleRevisionSchema.parse(revision)).toEqual(revision);
  });

  it.each([
    ["reservation window", { reservationClosesAt: revision.reservationOpensAt }],
    ["reservation-to-LIVE order", { reservationClosesAt: revision.startsAt, startsAt: "2026-09-10T08:59:00.000Z" }],
    ["LIVE window", { endsAt: revision.startsAt }],
    ["attendance window", { attendanceValidUntil: revision.attendanceValidFrom }],
  ])("rejects invalid %s ordering", (_case, override) => {
    expect(() => liveScheduleRevisionSchema.parse({ ...revision, ...override })).toThrow();
  });

  it.each([
    ["zero revision", { expectedRevision: 0 }],
    ["blank reason", { reason: "   " }],
    ["missing actor-controlled field", { reason: undefined }],
  ])("rejects %s", (_case, override) => {
    expect(() => liveScheduleRevisionSchema.parse({ ...revision, ...override })).toThrow();
  });
});
