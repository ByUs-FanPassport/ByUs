import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabasePlatformAnalyticsRepository, PlatformAnalyticsRepositoryError } from "./platform-analytics-repository";

const id = "11111111-1111-4111-8111-111111111111";
const metric = (value: unknown, source: string) => ({ state: "available", value, reason: null, source });
const payload = {
  window: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z", semantics: "[from,to)", asOf: "2026-09-02T00:00:00.000Z", timeZone: "Asia/Seoul" },
  totals: { fansAndWallets: metric(1,"app_users/user_wallets"), passports: metric(0,"fan_passports"), activeCreators: metric(0,"canonical operational facts"), firstReactions: metric(0,"fan_reactions"), reservations: metric(0,"live_reservations"), attendances: metric(0,"live_attendances"), onchainActions: metric(0,"blockchain_jobs") },
  trend: metric([],"canonical operational facts by Asia/Seoul date"), creators: metric([],"canonical operational facts grouped by celebrities"), lives: metric([],"live_events/canonical operational facts"),
  chain: { total: metric(0,"blockchain_jobs"), uniqueFans: metric(0,"blockchain_jobs linked operational owners"), successful: metric(0,"blockchain_jobs(status=COMPLETED)"), pending: metric(0,"blockchain_jobs(status=PENDING|PROCESSING|RETRYING)"), failed: metric(0,"blockchain_jobs(status=FAILED)"), breakdown: metric({passport:0,reaction:0,stamp:0,collectible:0},"blockchain_jobs.entity_type") },
};
describe("platform analytics repository", () => {
  it("calls the single guarded RPC and parses truthful envelopes", async () => {
    const database = { rpc: vi.fn(async()=>({data:payload,error:null})) };
    await expect(new SupabasePlatformAnalyticsRepository(database).read({adminAppUserId:id,adminAllowlistId:id,from:payload.window.from,to:payload.window.to,asOf:payload.window.asOf})).resolves.toEqual(payload);
    expect(database.rpc).toHaveBeenCalledWith("read_admin_platform_analytics", expect.objectContaining({p_actor_app_user_id:id,p_actor_admin_allowlist_id:id}));
  });
  it("fails closed for malformed data", async () => {
    await expect(new SupabasePlatformAnalyticsRepository({rpc:async()=>({data:{totals:{}},error:null})}).read({adminAppUserId:id,adminAllowlistId:id,from:payload.window.from,to:payload.window.to,asOf:payload.window.asOf})).rejects.toBeInstanceOf(PlatformAnalyticsRepositoryError);
  });
});

