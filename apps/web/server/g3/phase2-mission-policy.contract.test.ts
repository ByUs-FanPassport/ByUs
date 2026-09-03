import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260903016000_phase2_mission_submission_policy.sql"),
  "utf8",
);

describe("Phase 2 Mission reward policy lookup", () => {
  it("qualifies the policy column and stores it in an unambiguous variable", () => {
    expect(sql).toContain("activation.policy_version into strict v_policy_version");
    expect(sql).toContain("public.reward_policy_activation activation");
    expect(sql).toContain("response_record.id,response_record.id,v_policy_version,reward_setting.revision,reward_setting.id");
    expect(sql).not.toContain("select policy_version into strict policy_version");
  });
});
