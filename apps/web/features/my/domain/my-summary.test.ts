import { describe, expect, it } from "vitest";

import { mySummarySchema } from "./my-summary";

describe("MY summary contract", () => {
  it("accepts only the bounded dashboard projection", () => {
    const parsed = mySummarySchema.parse({
      profile: { nickname: "Kamilia" },
      passports: [{
        id: "11111111-1111-4111-8111-111111111111",
        celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" },
        issuedAt: "2026-07-21T00:00:00.000Z",
        stampCount: 2,
        score: { level: "Silver" },
        display: { level: "실버" },
        stampSummary: { knowledge: 1, reservation: 1, attendance: 0, survey: 0, total: 2 },
        stamps: [
          { type: "knowledge", issuedAt: "2026-07-21T00:00:00.000Z" },
          { type: "reservation", issuedAt: "2026-07-22T00:00:00.000Z" },
        ],
      }],
      reservations: [],
      availableBenefitCount: 2,
      unreadNotificationCount: 1,
    });
    expect(parsed).toEqual({
      profile: { nickname: "Kamilia" },
      passports: [{
        id: "11111111-1111-4111-8111-111111111111",
        celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" },
        issuedAt: "2026-07-21T00:00:00.000Z",
        stampCount: 2,
        score: { level: "Silver" },
        display: { level: "실버" },
        stampSummary: { knowledge: 1, reservation: 1, attendance: 0, survey: 0, total: 2 },
        stamps: [
          { type: "knowledge", issuedAt: "2026-07-21T00:00:00.000Z" },
          { type: "reservation", issuedAt: "2026-07-22T00:00:00.000Z" },
        ],
      }],
      reservations: [],
      availableBenefitCount: 2,
      unreadNotificationCount: 1,
    });
    expect(mySummarySchema.safeParse({ ...parsed, unreadNotificationCount: -1 }).success).toBe(false);
  });
});
