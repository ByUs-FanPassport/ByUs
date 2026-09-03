import { describe, expect, it } from "vitest";

import {
  areJourneyRequirementsComplete,
  evaluateJourneyRequestSchema,
  journeyRequirementSelectionSchema,
  journeySnapshotSchema,
} from "./journey";

const passportMissionId = "11111111-1111-4111-8111-111111111111";
const secondMissionId = "22222222-2222-4222-8222-222222222222";

function selection(mask: number, bonusTicketAmount = 3) {
  return {
    requirePassport: Boolean(mask & 1),
    requireReservation: Boolean(mask & 2),
    requireAttendance: Boolean(mask & 4),
    missions: mask & 8 ? [{ missionId: passportMissionId, version: 2 }] : [],
    bonusTicketAmount,
  };
}

const baseSnapshot = {
  liveEventId: "33333333-3333-4333-8333-333333333333",
  requirementRevisionId: "44444444-4444-4444-8444-444444444444",
  eligible: false,
  complete: false,
  requirements: {
    passport: { required: true, state: "complete" as const },
    reservation: { required: true, state: "complete" as const },
    attendance: { required: true, state: "incomplete" as const },
    missions: [
      { missionId: passportMissionId, version: 2, state: "complete" as const },
    ],
  },
  bonusTicketAmount: 3,
  completedAt: null,
  ticketLedgerId: null,
};

describe("Journey requirement selection", () => {
  it.each(Array.from({ length: 15 }, (_, index) => index + 1))(
    "accepts selectable requirement combination mask %i",
    (mask) => {
      expect(journeyRequirementSelectionSchema.parse(selection(mask))).toEqual(
        selection(mask),
      );
    },
  );

  it("accepts zero and multiple selected Missions while requiring some active condition", () => {
    expect(
      journeyRequirementSelectionSchema.parse(selection(1)).missions,
    ).toEqual([]);
    expect(
      journeyRequirementSelectionSchema.parse({
        ...selection(0),
        missions: [
          { missionId: passportMissionId, version: 2 },
          { missionId: secondMissionId, version: 7 },
        ],
      }).missions,
    ).toHaveLength(2);
    expect(() => journeyRequirementSelectionSchema.parse(selection(0))).toThrow();
  });

  it("rejects duplicate/invalid Mission versions and unsupported Ticket amounts", () => {
    expect(() =>
      journeyRequirementSelectionSchema.parse({
        ...selection(8),
        missions: [
          { missionId: passportMissionId, version: 2 },
          { missionId: passportMissionId, version: 2 },
        ],
      }),
    ).toThrow();
    expect(() =>
      journeyRequirementSelectionSchema.parse({
        ...selection(8),
        missions: [{ missionId: passportMissionId, version: 0 }],
      }),
    ).toThrow();
    for (const amount of [0, 3, 5]) {
      expect(
        journeyRequirementSelectionSchema.parse(selection(1, amount))
          .bonusTicketAmount,
      ).toBe(amount);
    }
    for (const amount of [-1, 6, 1.5]) {
      expect(() =>
        journeyRequirementSelectionSchema.parse(selection(1, amount)),
      ).toThrow();
    }
  });
});

describe("Journey owner contracts", () => {
  it("ignores inactive requirements and becomes complete on the final active action", () => {
    const before = {
      passport: { required: true, state: "complete" as const },
      reservation: { required: false, state: "incomplete" as const },
      attendance: { required: true, state: "incomplete" as const },
      missions: [
        { missionId: passportMissionId, version: 2, state: "complete" as const },
      ],
    };
    expect(areJourneyRequirementsComplete(before)).toBe(false);
    expect(
      areJourneyRequirementsComplete({
        ...before,
        attendance: { required: true, state: "complete" },
      }),
    ).toBe(true);
  });

  it("parses a complete immutable-revision snapshot without leaking unrelated facts", () => {
    const parsed = journeySnapshotSchema.parse({
      ...baseSnapshot,
      eligible: true,
      complete: true,
      requirements: {
        ...baseSnapshot.requirements,
        attendance: { required: true, state: "complete" },
      },
      completedAt: "2026-09-03T10:00:00.000Z",
      ticketLedgerId: "55555555-5555-4555-8555-555555555555",
    });
    expect(parsed.requirementRevisionId).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(JSON.stringify(parsed)).not.toMatch(
      /appUserId|passportId|reservationId|attendanceId|score/i,
    );
  });

  it("rejects contradictory eligibility, completion, and Ticket projections", () => {
    for (const invalid of [
      { ...baseSnapshot, eligible: true },
      { ...baseSnapshot, complete: true },
      { ...baseSnapshot, completedAt: "2026-09-03T10:00:00.000Z" },
      { ...baseSnapshot, ticketLedgerId: "55555555-5555-4555-8555-555555555555" },
      {
        ...baseSnapshot,
        bonusTicketAmount: 0,
        ticketLedgerId: "55555555-5555-4555-8555-555555555555",
      },
    ]) {
      expect(() => journeySnapshotSchema.parse(invalid)).toThrow();
    }
  });

  it("requires a strict UUID-only evaluation body", () => {
    const idempotencyKey = "66666666-6666-4666-8666-666666666666";
    expect(evaluateJourneyRequestSchema.parse({ idempotencyKey })).toEqual({
      idempotencyKey,
    });
    expect(() =>
      evaluateJourneyRequestSchema.parse({
        idempotencyKey,
        appUserId: "attacker",
      }),
    ).toThrow();
    expect(() =>
      evaluateJourneyRequestSchema.parse({ idempotencyKey: "not-a-uuid" }),
    ).toThrow();
  });
});
