import { describe, expect, it } from "vitest";
import { ownedRaffleResultSchema } from "./raffle-result";
import { isRecipientOverdue } from "./raffle-fulfillment-policy";

const pending = {
  benefitId: "10000000-0000-4000-8000-000000000001", campaignId: "10000000-0000-4000-8000-000000000002",
  title: "관람권", benefitHref: "/benefits/10000000-0000-4000-8000-000000000001", state: "pending",
  enteredTickets: 2, entryClosesAt: "2026-09-20T00:00:00+09:00", publishedAt: null, winnerId: null,
  method: "on_site_pickup", fulfillmentStatus: null, claimDisposition: "active",
  recipientDeadlineAt: null, recipientSubmitted: false, recipientEditable: false, policy: null,
};
describe("owned raffle result publication boundary", () => {
  it("accepts a pending entry without revealing an unpublished winner", () => {
    expect(ownedRaffleResultSchema.parse(pending).state).toBe("pending");
    expect(ownedRaffleResultSchema.safeParse({ ...pending, winnerId: pending.benefitId }).success).toBe(false);
  });
  it("rejects non-selection without publication", () => {
    expect(ownedRaffleResultSchema.safeParse({ ...pending, state: "not_won" }).success).toBe(false);
  });
  it("requires a real winning fulfillment", () => {
    expect(ownedRaffleResultSchema.safeParse({ ...pending, state: "won", publishedAt: "2026-09-20T00:01:00+09:00" }).success).toBe(false);
  });
  it("treats the exact deadline as overdue only for an unsubmitted recipient", () => {
    const deadline = "2026-09-27T00:01:00+09:00";
    expect(isRecipientOverdue(deadline, false, new Date(deadline))).toBe(true);
    expect(isRecipientOverdue(deadline, true, new Date(deadline))).toBe(false);
    expect(isRecipientOverdue(null, false, new Date(deadline))).toBe(false);
  });
});
