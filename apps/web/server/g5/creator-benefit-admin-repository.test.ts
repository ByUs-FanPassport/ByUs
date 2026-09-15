import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSupabaseBenefitAdminRepository } from "./benefit-admin-repository";
describe("creator campaign RPC dispatch", () => {
  it.each([false, true])("dispatches creator=%s without changing legacy payload", async creator => {
    const rpc=vi.fn().mockResolvedValue({ data: "campaign", error: null });
    const repo=createSupabaseBenefitAdminRepository({ url: "https://example.supabase.co", serviceRoleKey: "fixture" }, { rpc });
    await repo.saveCampaign({ appUserId: "actor", allowlistId: "allowlist" }, "correlation", { ...(creator ? { celebrityId: "creator" } : { liveEventId: "live" }), entryOpensAt: null, entryClosesAt: null, benefits: [], expectedRevision: null });
    expect(rpc.mock.calls[0]?.[0]).toBe(creator ? "save_admin_creator_benefit_campaign" : "save_admin_benefit_campaign");
    expect(rpc.mock.calls[0]?.[1]).toHaveProperty(creator ? "p_celebrity_id" : "p_live_event_id", creator ? "creator" : "live");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty(creator ? "p_live_event_id" : "p_celebrity_id");
  });
});
