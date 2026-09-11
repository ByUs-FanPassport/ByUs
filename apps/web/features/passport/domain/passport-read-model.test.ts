import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SOURCE_BY_TYPE,
  passportActivityContextSchema,
  stampSummarySchema,
  stampTypeLabel,
  stampShortLabel,
} from "./passport-read-model";

const sourceId = "11111111-1111-4111-8111-111111111111";

describe("membership Passport read model", () => {
  it("accepts certification-backed membership activity without LIVE context", () => {
    expect(ACTIVITY_SOURCE_BY_TYPE.membership).toBe("certification_submission");
    expect(passportActivityContextSchema.parse({
      sourceType: "certification_submission",
      sourceId,
      live: null,
    })).toEqual({ sourceType: "certification_submission", sourceId, live: null });
    expect(stampTypeLabel("ko", "membership")).toBe("멤버십 인증");
    expect(stampTypeLabel("en", "membership")).toBe("Membership Verification");
    expect(stampShortLabel("ko", "membership")).toBe("멤버십");
    expect(stampShortLabel("en", "membership")).toBe("MEMBER");
  });

  it("rejects LIVE context for certification submissions", () => {
    expect(passportActivityContextSchema.safeParse({
      sourceType: "certification_submission",
      sourceId,
      live: { slug: "kara-live", title: "KARA LIVE", linkable: true },
    }).success).toBe(false);
  });

  it("defaults membership to zero for old summaries and includes it in the total check", () => {
    expect(stampSummarySchema.parse({
      knowledge: 1,
      reservation: 0,
      attendance: 0,
      survey: 0,
      total: 1,
    }).membership).toBe(0);
    expect(stampSummarySchema.parse({
      knowledge: 1,
      reservation: 0,
      attendance: 0,
      survey: 0,
      membership: 1,
      total: 2,
    }).membership).toBe(1);
    expect(stampSummarySchema.safeParse({
      knowledge: 1,
      reservation: 0,
      attendance: 0,
      survey: 0,
      membership: 1,
      total: 1,
    }).success).toBe(false);
  });
});
