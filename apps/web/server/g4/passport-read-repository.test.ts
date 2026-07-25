import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabasePassportReadRepository } from "./passport-read-repository";

const passportId = "10000000-0000-4000-8000-000000000001";
const stampId = "20000000-0000-4000-8000-000000000001";
const activityId = "30000000-0000-4000-8000-000000000001";
const base = {
  id: passportId, owner: { nickname: null }, celebrity: { slug: "kara", name: "KARA", image: { url: "/kara.jpg", alt: "KARA", position: "center" } },
  businessStatus: "issued", mint: { status: "queued", txHash: null, tokenId: null }, issuedAt: "2026-07-21T01:00:00.000Z",
  score: { points: 1, level: "Bronze" }, stampSummary: { knowledge: 1, reservation: 0, attendance: 0, survey: 0, total: 1 },
};
const detailBase = { ...base, nextBenefit: null };
const context = { sourceType: "quiz_pass", sourceId: "50000000-0000-4000-8000-000000000001", live: null };
const stamp = { id: stampId, type: "knowledge", businessStatus: "issued", mint: { status: "queued", txHash: null, tokenId: null }, issuedAt: "2026-07-21T01:01:00.000Z", activityId, context };
const activity = { id: activityId, type: "knowledge", occurredAt: "2026-07-21T01:00:00.000Z", points: 1, stampId, context };

describe("SupabasePassportReadRepository", () => {
  it("uses only the three owner-scoped service RPCs and preserves RPC ordering", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [base], error: null })
      .mockResolvedValueOnce({ data: [{ ...detailBase, stamps: [stamp], activities: [activity] }], error: null })
      .mockResolvedValueOnce({ data: [{ id: stamp.id, type: stamp.type, businessStatus: stamp.businessStatus, mint: stamp.mint, issuedAt: stamp.issuedAt, passport: { id: passportId }, owner: { nickname: "FanOne" }, celebrity: base.celebrity, activity: { id: activityId, type: "knowledge", occurredAt: activity.occurredAt, points: 1, context } }], error: null });
    const repository = new SupabasePassportReadRepository({ rpc });
    const owner = "40000000-0000-4000-8000-000000000001";
    await expect(repository.findCollection({ appUserId: owner, locale: "ko" })).resolves.toMatchObject([{ id: passportId, display: { level: "브론즈", mintStatus: "발급 대기" } }]);
    await expect(repository.findPassport({ id: passportId, appUserId: owner, locale: "en" })).resolves.toMatchObject({
      stamps: [{ display: { type: "Fan Verification" }, context }],
      progress: { currentScore: 1, currentLevel: "Bronze", nextLevel: "Silver", nextThreshold: 5, remainingPoints: 4, percent: 20, maxed: false },
      nextBenefit: null,
    });
    await expect(repository.findStamp({ id: stampId, appUserId: owner, locale: "ko" })).resolves.toMatchObject({ owner: { nickname: "FanOne" }, display: { type: "팬 인증" }, activity: { context } });
    expect(rpc.mock.calls).toStrictEqual([
      ["get_owned_passport_collection", { p_app_user_id: owner, p_locale: "ko" }],
      ["get_owned_passport_detail", { p_passport_id: passportId, p_app_user_id: owner, p_locale: "en" }],
      ["get_owned_stamp_detail", { p_stamp_id: stampId, p_app_user_id: owner, p_locale: "ko" }],
    ]);
  });

  it("returns empty collection and opaque null details for zero owned rows", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [], error: null });
    const repository = new SupabasePassportReadRepository({ rpc });
    await expect(repository.findCollection({ appUserId: "owner", locale: "ko" })).resolves.toStrictEqual([]);
    await expect(repository.findPassport({ id: passportId, appUserId: "owner", locale: "ko" })).resolves.toBeNull();
    await expect(repository.findStamp({ id: stampId, appUserId: "owner", locale: "ko" })).resolves.toBeNull();
  });

  it("preserves archived LIVE titles while keeping their public-link contract false", async () => {
    const archivedContext = {
      sourceType: "live_reservation",
      sourceId: "50000000-0000-4000-8000-000000000002",
      live: { slug: "archived-live", title: "Archived LIVE", linkable: false },
    };
    const archivedStamp = { ...stamp, type: "reservation", context: archivedContext };
    const archivedActivity = { ...activity, type: "reservation", context: archivedContext };
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        ...detailBase,
        stampSummary: { knowledge: 0, reservation: 1, attendance: 0, survey: 0, total: 1 },
        stamps: [archivedStamp],
        activities: [archivedActivity],
      }],
      error: null,
    });
    const repository = new SupabasePassportReadRepository({ rpc });
    await expect(repository.findPassport({
      id: passportId,
      appUserId: "40000000-0000-4000-8000-000000000001",
      locale: "en",
    })).resolves.toMatchObject({
      stamps: [{ context: archivedContext }],
      activities: [{ context: archivedContext }],
    });
  });

  it("parses the authoritative next benefit with exactly one owner RPC", async () => {
    const nextBenefit = {
      id: "60000000-0000-4000-8000-000000000001",
      slug: "welcome-wallpaper",
      title: "Welcome wallpaper",
      state: "locked",
      allocationMode: "direct_claim",
      applicationStatus: null,
      eligibilityLabel: "Silver",
      minimumScore: 5,
      minimumLevel: "Silver",
      requiredStampType: null,
      requiredActivityType: null,
      missingConditions: [
        { type: "score", current: 1, required: 5 },
        { type: "level", current: "Bronze", required: "Silver" },
      ],
    };
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...detailBase, nextBenefit, stamps: [stamp], activities: [activity] }],
      error: null,
    });
    const repository = new SupabasePassportReadRepository({ rpc });
    const owner = "40000000-0000-4000-8000-000000000001";

    await expect(repository.findPassport({
      id: passportId,
      appUserId: owner,
      locale: "en",
    })).resolves.toMatchObject({ nextBenefit });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_owned_passport_detail", {
      p_passport_id: passportId,
      p_app_user_id: owner,
      p_locale: "en",
    });
  });

  it("fails closed when a LIVE-derived record loses its source context", async () => {
    const brokenContext = {
      sourceType: "live_reservation",
      sourceId: "50000000-0000-4000-8000-000000000002",
      live: null,
    };
    const brokenPassport = new SupabasePassportReadRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{
          ...detailBase,
          stampSummary: { knowledge: 0, reservation: 1, attendance: 0, survey: 0, total: 1 },
          stamps: [{ ...stamp, type: "reservation", context: brokenContext }],
          activities: [{ ...activity, type: "reservation", context: brokenContext }],
        }],
        error: null,
      }),
    });
    await expect(brokenPassport.findPassport({
      id: passportId,
      appUserId: "40000000-0000-4000-8000-000000000001",
      locale: "en",
    })).rejects.toThrow("projection is invalid");

    const brokenStamp = new SupabasePassportReadRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{
          id: stamp.id,
          type: "reservation",
          businessStatus: stamp.businessStatus,
          mint: stamp.mint,
          issuedAt: stamp.issuedAt,
          passport: { id: passportId },
          owner: { nickname: "FanOne" },
          celebrity: base.celebrity,
          activity: {
            id: activityId,
            type: "reservation",
            occurredAt: activity.occurredAt,
            points: 1,
            context: brokenContext,
          },
        }],
        error: null,
      }),
    });
    await expect(brokenStamp.findStamp({
      id: stampId,
      appUserId: "40000000-0000-4000-8000-000000000001",
      locale: "en",
    })).rejects.toThrow("projection is invalid");
  });

  it("fails closed on leaks, malformed chain facts, database errors, and impossible cardinality", async () => {
    const leaked = new SupabasePassportReadRepository({ rpc: vi.fn().mockResolvedValue({ data: [{ ...base, wallet: "secret" }], error: null }) });
    await expect(leaked.findCollection({ appUserId: "owner", locale: "ko" })).rejects.toThrow("projection is invalid");
    const databaseFailure = new SupabasePassportReadRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "service secret" } }) });
    await expect(databaseFailure.findPassport({ id: passportId, appUserId: "owner", locale: "ko" })).rejects.toThrow("query failed");
    const multiple = new SupabasePassportReadRepository({ rpc: vi.fn().mockResolvedValue({ data: [base, base], error: null }) });
    await expect(multiple.findPassport({ id: passportId, appUserId: "owner", locale: "ko" })).rejects.toThrow("multiple rows");
    const inconsistentLevel = new SupabasePassportReadRepository({ rpc: vi.fn().mockResolvedValue({ data: [{ ...detailBase, score: { points: 5, level: "Bronze" }, stamps: [], activities: [] }], error: null }) });
    await expect(inconsistentLevel.findPassport({ id: passportId, appUserId: "owner", locale: "ko" })).rejects.toThrow("projection is invalid");
  });
});
