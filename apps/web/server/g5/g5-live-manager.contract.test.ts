import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721084500_g5_live_manager.sql"), "utf8");
const rewardSql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260902013000_phase1_live_reward_settings.sql"), "utf8");
describe("ADM-005 database contract", () => {
  it("hashes plaintext within the server command at bcrypt cost 12", () => {
    expect(sql).toContain("extensions.crypt(p_fan_code_plaintext, extensions.gen_salt('bf', 12))");
    const sqlPattern = sql.match(/'fanCodeConfigured', l\.fan_code_hash ~ '([^']+)'/)?.[1];
    expect(sqlPattern).toBeDefined();
    expect(new RegExp(sqlPattern!).test("$2a$12$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuu")).toBe(true);
    expect(sql).not.toMatch(/jsonb_build_object\([^;]*fan_code_plaintext/is);
  });
  it("never projects the fan code hash or plaintext", () => {
    const projection = sql.slice(sql.indexOf("create function public.get_admin_live_manager"), sql.indexOf("create function public.save_admin_live_draft"));
    expect(projection).not.toContain("fan_code_hash',"); expect(projection).not.toContain("fan_code_plaintext");
    expect(projection).toContain("'fanCodeConfigured'");
  });
  it("limits mutation commands to admin and operator and carries correlation IDs", () => {
    expect(sql).toContain("a.role in ('admin', 'operator')");
    expect(sql).toContain("p_correlation_id"); expect(sql).toContain("correlation_id");
  });
  it("uses the existing append-only override and archive policies", () => {
    expect(sql).toContain("insert into public.live_status_overrides");
    expect(sql).toContain("live_status_overrides_reject_archived");
    expect(sql).toContain("where l.id=new.live_event_id and l.archived_at is null for update");
    expect(sql).not.toContain("delete from public.live_events");
  });
  it("computes audit before-state without the newly inserted override", () => {
    expect(sql).toContain("o.id<>new.id");
    expect(sql).not.toContain("before_status := public.live_effective_status_at(new.live_event_id, new.effective_from)");
  });
  it("keeps the generic archive row result inside PostgreSQL", () => {
    expect(sql).toContain("create function public.archive_admin_live");
    expect(sql).toContain("perform public.archive_admin_content");
  });
});

describe("Phase 1 LIVE reward settings database contract", () => {
  it("stores append-only bounded revisions with active-policy defaults", () => {
    expect(rewardSql).toContain("create table public.live_reward_setting_revisions");
    expect(rewardSql).toContain("mission_score between 0 and 3");
    expect(rewardSql).toContain("mission_ticket between 0 and 2");
    expect(rewardSql).toContain("journey_bonus_ticket between 0 and 5");
    expect(rewardSql).toContain("join public.reward_policy_versions p on p.version=activation.policy_version");
    expect(rewardSql).toContain("policy.mission_score_default");
    expect(rewardSql).toContain("policy.mission_ticket_default");
    expect(rewardSql).toContain("policy.journey_ticket_default");
    expect(rewardSql).not.toContain("where p.version=2");
    expect(rewardSql).toContain("fan_ticket_ledger_reward_setting_revision_fk");
    expect(rewardSql).toContain("validate_fan_ticket_reward_setting_identity");
    expect(rewardSql).toContain("setting.revision=new.setting_revision");
    expect(rewardSql).toContain("setting.policy_version=new.policy_version");
    expect(rewardSql).toContain("live.celebrity_id=new.celebrity_id");
    expect(rewardSql).toContain("before update or delete");
  });

  it("enforces optimistic concurrency and immutable publication or issuance", () => {
    expect(rewardSql).toContain("stale reward settings revision");
    expect(rewardSql).toContain("published reward settings are immutable");
    expect(rewardSql).toContain("reward settings with issuance are immutable");
    expect(rewardSql).toContain("for update");
  });

  it("binds each survey version to exactly one published revision", () => {
    expect(rewardSql).toContain("create table public.live_survey_reward_setting_bindings");
    expect(rewardSql).toContain("survey_id uuid primary key");
    expect(rewardSql).toContain("published reward revision is required");
    expect(rewardSql).toContain("survey reward binding is immutable");
  });

  it("audits actor, correlation, and before-after state behind service RPCs", () => {
    expect(rewardSql).toContain("p_actor_admin_allowlist_id");
    expect(rewardSql).toContain("p_correlation_id");
    expect(rewardSql).toContain("before_after_summary");
    expect(rewardSql).toContain("public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true)");
    expect(rewardSql).toContain("public.get_admin_live_reward_settings(uuid,uuid,uuid) to service_role");
    expect(rewardSql).toContain("revoke insert,update,delete,truncate on public.live_reward_setting_revisions");
  });

  it("projects configured totals without calling authentication score", () => {
    expect(rewardSql).toContain("'configuredLiveScoreMaximum', 1 + 3 + selected.mission_score");
    expect(rewardSql).toContain("'projectedLiveTicketMaximum', 1 + 2 + selected.mission_ticket + selected.journey_bonus_ticket");
    expect(rewardSql).toContain("'passportVerificationTicket', 1");
    expect(rewardSql).not.toContain("authenticationScore");
  });
});
