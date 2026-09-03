import { describe, expect, it } from "vitest";
import { mySummarySchema } from "./my-summary";

const id = "11111111-1111-4111-8111-111111111111";
const summary = {
  profile: { nickname: "Kamilia" },
  creators: [{ celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" }, relationship: "passport", passport: { id, tier: "Silver", score: 15, remainingToNextTier: 35 }, ticketBalance: 4, firstReaction: { completedAt: "2026-07-21T00:00:00.000Z", txHash: null } }],
  live: { upcoming: [], history: [] },
  rewards: { availableCount: 0, entries: 2, items: [] },
  collection: { passportCount: 1, stampCount: 2, collectibleCount: 0, recent: [{ kind: "stamp", id, title: "KARA Stamp", occurredAt: "2026-07-21T00:00:00.000Z", href: `/passports/${id}` }] },
  unreadNotificationCount: 1,
} as const;

describe("MY summary contract", () => {
  it("accepts the strict bounded owner projection", () => {
    expect(mySummarySchema.parse(summary)).toEqual(summary);
    expect(mySummarySchema.safeParse({ ...summary, walletAddress: "0xsecret" }).success).toBe(false);
  });

  it("rejects invalid counts and unsafe collection links", () => {
    expect(mySummarySchema.safeParse({ ...summary, unreadNotificationCount: -1 }).success).toBe(false);
    expect(mySummarySchema.safeParse({ ...summary, collection: { ...summary.collection, recent: [{ ...summary.collection.recent[0], href: "https://evil.example" }] } }).success).toBe(false);
  });
});
