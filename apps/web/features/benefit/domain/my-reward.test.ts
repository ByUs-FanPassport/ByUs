import { describe, expect, it } from "vitest";
import { myRewardSchema, parseMyRewards } from "./my-reward";

const base = {
  rewardResultId: "10000000-0000-4000-8000-000000000001",
  winnerId: "20000000-0000-4000-8000-000000000001",
  benefitId: "30000000-0000-4000-8000-000000000001",
  title: "Signed album",
  campaignId: "40000000-0000-4000-8000-000000000001",
  result: "won" as const,
  method: "physical_shipping" as const,
  status: "information_required" as const,
  enteredTickets: 7,
  recipientRequired: true,
  updatedAt: "2026-09-04T00:00:00.000Z",
  benefitHref: "/benefits/30000000-0000-4000-8000-000000000001",
};

describe("MyReward", () => {
  it.each([
    ["digital", "ready", false],
    ["physical_shipping", "information_required", true],
    ["on_site_pickup", "pickup_available", false],
  ] as const)("accepts won %s state", (method, status, recipientRequired) => {
    expect(
      myRewardSchema.parse({ ...base, method, status, recipientRequired }),
    ).toMatchObject({ method, status, recipientRequired });
  });

  it("accepts a stable non-selected result with no winner", () => {
    expect(
      myRewardSchema.parse({
        ...base,
        winnerId: null,
        result: "not_selected",
        method: null,
        status: "not_selected",
        recipientRequired: false,
      }),
    ).toMatchObject({ winnerId: null, result: "not_selected" });
  });

  it("rejects impossible winner shapes and raw PII", () => {
    expect(() =>
      myRewardSchema.parse({ ...base, winnerId: null }),
    ).toThrow();
    expect(() => parseMyRewards([{ ...base, phone: "010-secret" }])).toThrow();
  });
});
