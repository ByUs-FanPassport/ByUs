import { describe, expect, it } from "vitest";

import { mySummarySchema } from "./my-summary";

describe("MY summary contract", () => {
  it("accepts only the bounded dashboard projection", () => {
    const parsed = mySummarySchema.parse({
      profile: { nickname: "Kamilia" },
      passports: [],
      reservations: [],
      availableBenefitCount: 2,
      unreadNotificationCount: 1,
    });
    expect(parsed).toEqual({
      profile: { nickname: "Kamilia" },
      passports: [],
      reservations: [],
      availableBenefitCount: 2,
      unreadNotificationCount: 1,
    });
    expect(mySummarySchema.safeParse({ ...parsed, unreadNotificationCount: -1 }).success).toBe(false);
  });
});
