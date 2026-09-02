import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260902015000_activate_reward_policy_v2.sql",
  ),
  "utf8",
).toLowerCase();
const surveyBindingSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260902014000_phase1_survey_reward_binding.sql",
  ),
  "utf8",
).toLowerCase();

describe("Phase 1 reward integrity activation gate", () => {
  it("fails closed unless the singleton is still on the audited v1 baseline", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("current_activation.policy_version <> 1");
    expect(sql).toContain("reward policy activation expected v1");
    expect(sql).toContain("version = 2");
    expect(sql).toContain(") <> 5 then");
  });

  it("checks grandfathered Tier monotonicity before activation", () => {
    expect(sql).toContain("tier cutover snapshot backfill is incomplete");
    expect(sql).toContain("tier downgrade detected");
    expect(sql).toContain("get_fan_effective_tier_for_score");
    expect(sql).toContain("fan_level_rank");
  });

  it("checks Ticket non-negativity and both replay uniqueness boundaries", () => {
    expect(sql).toContain("negative ticket balance detected");
    expect(sql).toContain("duplicate ticket idempotency key detected");
    expect(sql).toContain("duplicate ticket semantic source detected");
    expect(sql).toContain("group by app_user_id, celebrity_id");
    expect(sql).toContain("group by idempotency_key");
    expect(sql).toContain("group by app_user_id, celebrity_id, source_type, source_id");
  });

  it("requires every public or response-bearing Survey to have a valid immutable reward binding", () => {
    const responseIndex = surveyBindingSql.indexOf(
      "create index if not exists live_survey_responses_survey_idx",
    );
    const firstResponseBearingScan = surveyBindingSql.indexOf(
      "from public.live_survey_responses",
    );

    expect(responseIndex).toBeGreaterThan(-1);
    expect(surveyBindingSql).toContain("on public.live_survey_responses(survey_id)");
    expect(firstResponseBearingScan).toBeGreaterThan(responseIndex);
    expect(sql).toContain("survey reward binding backfill is incomplete");
    expect(sql).toContain("survey reward binding is invalid");
    expect(sql).toContain("s.publication_status = 'published'");
    expect(sql).toContain("live_survey_responses");
    expect(sql).toContain("r.lifecycle_status <> 'published'");
    expect(sql).toContain("r.live_event_id <> s.live_event_id");
  });

  it("writes a system audit row before moving the singleton pointer v1 to v2", () => {
    const auditInsert = sql.indexOf("insert into public.reward_policy_activation_audit");
    const pointerUpdate = sql.indexOf("update public.reward_policy_activation");

    expect(sql).toContain("activation_source");
    expect(sql).toContain("'migration'");
    expect(auditInsert).toBeGreaterThan(-1);
    expect(pointerUpdate).toBeGreaterThan(auditInsert);
    expect(sql).toContain("set policy_version = 2");
    expect(sql).not.toMatch(/\b(delete|truncate)\s+(from\s+)?public\./);
  });
});
