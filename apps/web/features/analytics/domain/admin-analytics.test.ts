import { describe, expect, it } from "vitest";
import { analyticsWindowSchema, integerMetricSchema } from "./admin-analytics";

const valid = {
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-09-02T00:00:00.000Z",
  semantics: "[from,to)" as const,
  asOf: "2026-09-02T00:00:00.000Z",
  timeZone: "Asia/Seoul" as const,
};

describe("admin analytics envelopes", () => {
  it("keeps measured zero distinct from unavailable and suppressed", () => {
    expect(integerMetricSchema.parse({ state: "available", value: 0, reason: null, source: "app_users/user_wallets" }).value).toBe(0);
    expect(integerMetricSchema.parse({ state: "unavailable", value: null, reason: "WALLET_INVARIANT_FAILED", source: null }).state).toBe("unavailable");
    expect(integerMetricSchema.parse({ state: "suppressed", value: null, reason: "SMALL_COHORT_LT_5", source: "live_survey_responses" }).state).toBe("suppressed");
  });

  it("enforces [from,to), asOf, and Asia/Seoul", () => {
    expect(analyticsWindowSchema.parse(valid)).toEqual(valid);
    expect(analyticsWindowSchema.safeParse({ ...valid, from: valid.to }).success).toBe(false);
    expect(analyticsWindowSchema.safeParse({ ...valid, asOf: valid.from }).success).toBe(false);
    expect(analyticsWindowSchema.safeParse({ ...valid, timeZone: "UTC" }).success).toBe(false);
  });
});

