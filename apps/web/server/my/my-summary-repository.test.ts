import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PublicImageMySummaryRepository, SupabaseMySummaryRepository } from "./my-summary-repository";

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
  it("moves elapsed scheduled reservations into history without inventing an ended status", async () => {
    const event = { id, slug: "ifew-live", title: "이퓨 정기 LIVE", startsAt: "2026-09-29T22:00:00Z", effectiveStatus: "scheduled", attended: false };
    const future = { ...event, id: "22222222-2222-4222-8222-222222222222", slug: "future-live", startsAt: "2026-10-10T00:00:00Z" };
    const live = { ...event, id: "33333333-3333-4333-8333-333333333333", slug: "live-now", effectiveStatus: "live" };
    const ended = { ...event, id: "44444444-4444-4444-8444-444444444444", slug: "ended-live", startsAt: "2026-09-01T00:00:00Z", effectiveStatus: "ended", attended: true };
    const data = { ...valid, live: { upcoming: [event, future, live], history: [ended] } };
    const repository = new SupabaseMySummaryRepository({ rpc: async () => ({ data, error: null }) });
    const result = await repository.get({ appUserId: id, locale: "ko", asOf: new Date("2026-10-09T00:00:00Z") });
    expect(result.live).toEqual({ upcoming: [live, future], history: [event, ended] });
    expect(data.live.upcoming).toEqual([event, future, live]);
  });
  it("fails closed on database and projection errors", async () => {
    await expect(new SupabaseMySummaryRepository({ rpc: async () => ({ data: null, error: {} }) }).get({ appUserId: id, locale: "en", asOf: new Date() })).rejects.toThrow("query failed");
    await expect(new SupabaseMySummaryRepository({ rpc: async () => ({ data: { nope: true }, error: null }) }).get({ appUserId: id, locale: "en", asOf: new Date() })).rejects.toThrow("projection is invalid");
  });

  it("batch-attaches public creator photos while preserving owners without a public projection", async () => {
    const data = {
      ...valid,
      creators: [
        { celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" }, relationship: "passport" as const, passport: null, ticketBalance: 0, firstReaction: null },
        { celebrity: { slug: "private", name: "Private", image: "/private.jpg" }, relationship: "passport" as const, passport: null, ticketBalance: 0, firstReaction: null },
      ],
    };
    const readCelebrityPhotoSetsBySlug = vi.fn().mockResolvedValue({ kara: { portrait: null } });
    const repository = new PublicImageMySummaryRepository(
      new SupabaseMySummaryRepository({ rpc: vi.fn().mockResolvedValue({ data, error: null }) }),
      { readCelebrityPhotoSetsBySlug, readLivePhotoSetsBySlug: vi.fn() },
    );

    const result = await repository.get({ appUserId: id, locale: "ko", asOf: new Date() });

    expect(readCelebrityPhotoSetsBySlug).toHaveBeenCalledExactlyOnceWith(["kara", "private"]);
    expect(result.creators[0]?.celebrity.photos).toEqual({ portrait: null });
    expect(result.creators[1]?.celebrity).toEqual(data.creators[1]?.celebrity);
  });
});
