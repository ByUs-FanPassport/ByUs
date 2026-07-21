import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createSupabaseFanOperationsRepository } from "./fan-operations-repository";

const actor = {
  appUserId: "11111111-1111-4111-8111-111111111111",
  allowlistId: "22222222-2222-4222-8222-222222222222",
};
const fanId = "33333333-3333-4333-8333-333333333333";

describe("Supabase Fan Operations repository", () => {
  it("calls the minimal list RPC without returning the email search input", async () => {
    const row = {
      fanId,
      nickname: "Kamilia",
      accountStatus: "active",
      maskedWallet: "0x1234…abcd",
      createdAt: "2026-07-21T00:00:00Z",
      celebritySummaries: [],
      cursor: { createdAt: "2026-07-21T00:00:00Z", id: fanId },
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const repo = createSupabaseFanOperationsRepository(
      { url: "url", serviceRoleKey: "key" },
      { rpc } as never,
    );
    const result = await repo.list({
      actor,
      correlationId: actor.appUserId,
      locale: "ko",
      query: "fan@example.com",
      celebrityId: null,
      accountStatus: null,
      cursor: null,
      limit: 50,
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_admin_fans",
      expect.objectContaining({ p_query: "fan@example.com", p_limit: 50 }),
    );
    expect(result.items[0]).toEqual(row);
    expect(JSON.stringify(result)).not.toContain("fan@example.com");
  });

  it("maps detail and atomic adjustment RPCs", async () => {
    const detail = {
      fanId,
      nickname: "Kamilia",
      accountStatus: "active",
      createdAt: "2026-07-21T00:00:00Z",
      wallets: [],
      passports: [],
    };
    const adjustment = {
      adjustmentId: actor.allowlistId,
      points: -1,
      resultingScore: 4,
      createdAt: "2026-07-21T00:00:00Z",
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: detail, error: null })
      .mockResolvedValueOnce({ data: adjustment, error: null });
    const repo = createSupabaseFanOperationsRepository(
      { url: "url", serviceRoleKey: "key" },
      { rpc } as never,
    );
    await expect(
      repo.detail({
        actor,
        correlationId: actor.appUserId,
        fanId,
        locale: "en",
      }),
    ).resolves.toEqual(detail);
    await expect(
      repo.adjust({
        actor,
        correlationId: actor.appUserId,
        fanId,
        celebrityId: actor.allowlistId,
        points: -1,
        reason: "Duplicate activity correction",
        idempotencyKey: fanId,
      }),
    ).resolves.toEqual(adjustment);
    expect(rpc).toHaveBeenLastCalledWith(
      "admin_adjust_fan_score",
      expect.objectContaining({
        p_points: -1,
        p_reason: "Duplicate activity correction",
      }),
    );
  });

  it("classifies privacy-safe database errors", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { message: "G5_FAN_ADJUSTMENT_FORBIDDEN secret" },
      });
    const repo = createSupabaseFanOperationsRepository(
      { url: "url", serviceRoleKey: "key" },
      { rpc } as never,
    );
    await expect(
      repo.adjust({
        actor,
        correlationId: actor.appUserId,
        fanId,
        celebrityId: actor.allowlistId,
        points: 1,
        reason: "Manual verified correction",
        idempotencyKey: fanId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an RPC response outside the bounded score DTO", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: {
          adjustmentId: fanId,
          points: 1,
          resultingScore: 1_000_001,
          createdAt: "2026-07-21T00:00:00Z",
        },
        error: null,
      });
    const repo = createSupabaseFanOperationsRepository(
      { url: "url", serviceRoleKey: "key" },
      { rpc } as never,
    );
    await expect(
      repo.adjust({
        actor,
        correlationId: actor.appUserId,
        fanId,
        celebrityId: actor.allowlistId,
        points: 1,
        reason: "Manual verified correction",
        idempotencyKey: fanId,
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
