import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260902010000_phase1_reward_policy.sql",
  ),
  "utf8",
).toLowerCase();

describe("Phase 1 reward policy database contract", () => {
  it("stores immutable v1 and v2 policy documents while leaving v1 active", () => {
    expect(sql).toContain("create table public.reward_policy_versions");
    expect(sql).toContain("published_at timestamptz not null");
    expect(sql).toMatch(/values\s+\(1,/);
    expect(sql).toMatch(/,\s*\(2,/);
    expect(sql).toContain("'silver', 15");
    expect(sql).toContain("'gold', 50");
    expect(sql).toContain("'platinum', 120");
    expect(sql).toContain("'diamond', 250");
    expect(sql).toContain("values (true, 1,");
    expect(sql).toContain("reward policy versions are immutable");
  });

  it("keeps activation separate, singleton, effective-dated, and audited", () => {
    expect(sql).toContain("create table public.reward_policy_activation");
    expect(sql).toContain("singleton boolean primary key");
    expect(sql).toContain("check (singleton)");
    expect(sql).toContain("effective_at timestamptz not null");
    expect(sql).toContain("create table public.reward_policy_activation_audit");
    expect(sql).toContain("previous_policy_version");
    expect(sql).toContain("activated_policy_version");
    expect(sql).toContain("actor_app_user_id");
  });

  it("activates an existing published policy through one audited RPC", () => {
    expect(sql).toContain("create function public.activate_reward_policy(");
    expect(sql).toContain("for update");
    expect(sql).toContain("from public.reward_policy_versions");
    expect(sql).toContain("insert into public.reward_policy_activation_audit");
    expect(sql).not.toContain("p_policy_version >");
  });

  it("rejects future activation because the singleton pointer is not a scheduler", () => {
    expect(sql).toContain("p_effective_at > transaction_timestamp()");
    expect(sql).toContain("future reward policy activation is not supported");
  });

  it("validates policy bounds and exactly five ordered Tier milestones before moving the pointer", () => {
    expect(sql).toContain("mission_score_default between policy.mission_score_min and policy.mission_score_max");
    expect(sql).toContain("mission_ticket_default between policy.mission_ticket_min and policy.mission_ticket_max");
    expect(sql).toContain("journey_ticket_default between policy.journey_ticket_min and policy.journey_ticket_max");
    expect(sql).toContain("('bronze', 1), ('silver', 2), ('gold', 3), ('platinum', 4), ('diamond', 5)");
    expect(sql).toContain("lag(minimum_score) over (order by tier_rank)");
    expect(sql).toContain("minimum_score <= previous_minimum_score");
    expect(sql).toContain("tier milestones are invalid");

    const validation = sql.indexOf("p_effective_at > transaction_timestamp()");
    const pointerUpdate = sql.indexOf("update public.reward_policy_activation set");
    expect(validation).toBeGreaterThan(-1);
    expect(pointerUpdate).toBeGreaterThan(validation);
  });

  it("denies direct writes to published policy and activation records", () => {
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke all on table public.reward_policy_versions");
    expect(sql).toContain("revoke all on table public.reward_policy_activation");
    expect(sql).toContain("revoke all on function public.activate_reward_policy");
    expect(sql).toContain("grant execute on function public.activate_reward_policy");
  });
});
