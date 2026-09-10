import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseMySummaryRepository } from "./my-summary-repository";

const id = "11111111-1111-4111-8111-111111111111";
const valid = { profile: { nickname: null }, creators: [], live: { upcoming: [], history: [] }, rewards: { availableCount: 0, entries: 0, items: [] }, collection: { passportCount: 0, stampCount: 0, collectibleCount: 0, recent: [] }, unreadNotificationCount: 0 };

describe("MY summary repository", () => {
  it("opts into the stage RPC without rewriting authoritative progress", async () => {
    const stageProgress = { policyVersion: 2, current: { key: "silver-1", tier: "Silver", subdivision: 1, rank: 2, minimumScore: 15 }, next: { key: "silver-2", tier: "Silver", subdivision: 2, rank: 3, minimumScore: 30 }, remaining: 8, progressPercent: 46 };
    const data = { ...valid, creators: [{ celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" }, relationship: "passport", passport: { id, tier: "Silver", score: 22, remainingToNextTier: 28, stageProgress }, ticketBalance: 0, firstReaction: null }] };
    const rpc = vi.fn(async () => ({ data, error: null }));
    const result = await new SupabaseMySummaryRepository({ rpc }).get({ appUserId: id, locale: "en", asOf: new Date("2026-09-10T00:00:00Z"), includeStages: true });
    expect(result).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_owned_my_fan_activity_with_stages", { p_app_user_id: id, p_locale: "en", p_as_of: "2026-09-10T00:00:00.000Z" });
  });
  it("uses one owner-scoped RPC with an explicit clock", async () => {
    const rpc = vi.fn(async () => ({ data: valid, error: null }));
    const repository = new SupabaseMySummaryRepository({ rpc });
    await expect(repository.get({ appUserId: id, locale: "ko", asOf: new Date("2026-09-04T00:00:00Z") })).resolves.toEqual(valid);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_owned_my_fan_activity", { p_app_user_id: id, p_locale: "ko", p_as_of: "2026-09-04T00:00:00.000Z" });
  });
  it("fails closed on database and projection errors", async () => {
    await expect(new SupabaseMySummaryRepository({ rpc: async () => ({ data: null, error: {} }) }).get({ appUserId: id, locale: "en", asOf: new Date() })).rejects.toThrow("query failed");
    await expect(new SupabaseMySummaryRepository({ rpc: async () => ({ data: { nope: true }, error: null }) }).get({ appUserId: id, locale: "en", asOf: new Date() })).rejects.toThrow("projection is invalid");
  });
});
