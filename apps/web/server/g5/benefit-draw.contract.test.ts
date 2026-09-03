import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("../../supabase/migrations/20260903021000_phase4_weighted_benefit_draw.sql", "utf8");
describe("Phase 4 draw SQL", () => {
  it("uses exact seed and UUID bytes with the approved weighted rank", () => {
    expect(sql).toContain("v_seed||pg_catalog.uuid_send(v_item.benefit_id)||pg_catalog.uuid_send(w.app_user_id)");
    expect(sql).toContain("(public.benefit_digest_uint256(d.digest_bytes)+1)");
    expect(sql).toContain("/(power(2::numeric,256)+1)");
    expect(sql).toContain("(-ln(s.uniform_value)/s.weight)");
  });
  it("locks once, snapshots every result, and never exposes the raw seed", () => {
    expect(sql).toContain("where id=p_campaign_id for update");
    expect(sql).toContain("PHASE4_BENEFIT_DRAW_ALREADY_EXECUTED");
    expect(sql).toContain("benefit_draw_secrets(draw_id,raw_seed)");
    expect(sql).toContain("'not_selected'::public.benefit_draw_candidate_result");
    expect(sql).not.toMatch(/jsonb_build_object\([^;]*raw_seed/s);
    expect(sql).toContain("revoke all on function public.execute_admin_benefit_draw");
  });
  it("binds winners to the exact candidate identity and allows cross-Benefit repeats", () => {
    expect(sql).toContain("benefit_draw_winner_candidate_identity_fk");
    expect(sql).toContain("candidate_id,draw_id,campaign_id,benefit_id,app_user_id");
  });
});
