import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260902011000_phase1_tier_cutover.sql"), "utf8");
const normalized = sql.toLowerCase();
const benefitRepository = readFileSync(
  resolve(process.cwd(), "server/g4/benefit-repository.ts"),
  "utf8",
);

const callableTierConsumers = [
  "get_owned_passport_collection", "get_owned_passport_detail",
  "build_fan_activity_completion", "build_owned_live_reservation_result",
  "build_owned_live_attendance_result", "build_owned_live_survey_submission_result",
  "get_admin_fans", "read_admin_creator_analytics", "claim_benefit",
  "assert_benefit_application_eligibility", "project_score_unlock_events",
  "project_benefit_unlock_events",
] as const;

describe("Phase 1 Tier v2 cutover database contract", () => {
  it("centralizes the 0/15/50/120/250 policy instead of adding another CASE", () => {
    expect(normalized).toContain("create function public.fan_level_for_score(p_score integer,p_policy_version integer)");
    expect(normalized).toContain("reward_policy_tier_milestones");
    expect(normalized).not.toMatch(/p_score\s*>=\s*(5|10|20|35)/);
  });

  it("snapshots the union of ledger and event relationships at one cutover time", () => {
    expect(normalized).toContain("create table public.fan_tier_cutover_snapshots");
    expect(normalized).toContain("select app_user_id,celebrity_id from public.fan_score_ledger\n    union");
    expect(normalized).toContain("select app_user_id,celebrity_id from public.fan_level_events");
    expect(normalized).toContain("transaction_timestamp()");
    expect(normalized).toContain("max(public.fan_level_rank(event.current_level))");
  });

  it("makes effective Tier monotonic across snapshot, history, and active score", () => {
    expect(normalized).toContain("create function public.get_fan_effective_tier_for_score");
    expect(normalized).toContain("snapshot.attained_tier_rank");
    expect(normalized).toContain("max(public.fan_level_rank(event.current_level))");
    expect(normalized).toContain("tier_rank<=public.fan_level_rank(v_current_level)");
  });

  it("versions new events and grandfathers pre-existing Benefit criteria", () => {
    expect(normalized).toContain("add column policy_version integer references public.reward_policy_versions");
    expect(normalized).toContain("set policy_version=1");
    expect(normalized).toContain("add column reward_policy_version integer references public.reward_policy_versions");
    expect(normalized).toContain("set reward_policy_version=1");
    expect(normalized).toContain("'schemaversion',2,'policyversion'");
  });

  it("keeps an explicit inventory of every callable SQL Tier consumer", () => {
    for (const consumer of callableTierConsumers) expect(normalized).toContain(consumer);
  });

  it("exposes narrow service-role Tier reads", () => {
    expect(normalized).toContain("revoke all on function public.get_fan_effective_tier(uuid,uuid)");
    expect(normalized).toContain("grant execute on function public.get_fan_effective_tier(uuid,uuid) to service_role");
    expect(normalized).toContain("create function public.get_fan_score_and_effective_tier");
    expect(normalized).toContain("score as materialized");
    expect(normalized).toContain("'effectivetier',public.get_fan_effective_tier_for_score");
    expect(normalized).toContain("grant execute on function public.get_fan_score_and_effective_tier(uuid,uuid) to service_role");
    expect(benefitRepository).toContain(
      'this.database.rpc("get_fan_score_and_effective_tier"',
    );
    expect(benefitRepository).not.toContain('.from("fan_score_ledger")');
  });
});
