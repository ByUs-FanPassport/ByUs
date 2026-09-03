import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("server-only", () => ({}));
import { SupabaseMyRewardRepository } from "./my-reward-repository";

const result = {
  rewardResultId: "10000000-0000-4000-8000-000000000001",
  winnerId: null,
  benefitId: "30000000-0000-4000-8000-000000000001",
  title: "Signed album",
  campaignId: "40000000-0000-4000-8000-000000000001",
  result: "not_selected",
  method: null,
  status: "not_selected",
  enteredTickets: 3,
  recipientRequired: false,
  updatedAt: "2026-09-04T00:00:00.000Z",
  benefitHref: "/benefits/30000000-0000-4000-8000-000000000001",
};

describe("SupabaseMyRewardRepository", () => {
  it("derives from owner operational rows without joining recipient PII", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "../../supabase/migrations/20260903023000_phase4_my_reward_read.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("where dc.app_user_id=p_app_user_id");
    expect(sql).toContain("order by");
    expect(sql).toContain("dc.id desc");
    expect(sql).toContain("sum(e.ticket_amount)");
    expect(sql).not.toContain("benefit_recipient_private");
    expect(sql).toContain(
      "revoke all on function public.get_owned_benefit_rewards(uuid)",
    );
  });
  it("uses one owner-scoped operational RPC and preserves stable sorting", async () => {
    const won = {
      ...result,
      rewardResultId: "10000000-0000-4000-8000-000000000002",
      winnerId: "20000000-0000-4000-8000-000000000002",
      result: "won",
      method: "digital",
      status: "ready",
      enteredTickets: 5,
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    const rpc = vi.fn().mockResolvedValue({ data: [won, result], error: null });
    const repository = new SupabaseMyRewardRepository({ rpc });
    await expect(repository.list({ appUserId: "owner" })).resolves.toEqual([
      won,
      result,
    ]);
    expect(rpc).toHaveBeenCalledWith("get_owned_benefit_rewards", {
      p_app_user_id: "owner",
    });
  });

  it("returns empty and fails closed on DB errors or leaked PII", async () => {
    await expect(
      new SupabaseMyRewardRepository({
        rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      }).list({ appUserId: "owner" }),
    ).resolves.toEqual([]);
    await expect(
      new SupabaseMyRewardRepository({
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "secret" } }),
      }).list({ appUserId: "owner" }),
    ).rejects.toThrow("query failed");
    await expect(
      new SupabaseMyRewardRepository({
        rpc: vi.fn().mockResolvedValue({
          data: [{ ...result, address1: "secret" }],
          error: null,
        }),
      }).list({ appUserId: "owner" }),
    ).rejects.toThrow("projection is invalid");
  });
});
