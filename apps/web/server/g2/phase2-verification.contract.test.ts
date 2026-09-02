import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";

const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260902022000_phase2_verification_reward_cooldown.sql"),"utf8");
describe("Phase 2 verification",()=>{
  it("enforces a server cooldown after three failures and resets after success",()=>{
    expect(sql).toContain("failures>=3");
    expect(sql).toContain("interval '1 minute'");
    expect(sql).toContain("state.cooldown_until>statement_timestamp()");
    expect(sql).toContain("set consecutive_failures=0,cooldown_until=null");
  });
  it("credits the canonical quiz pass once and snapshots Reaction attribution",()=>{
    expect(sql).toContain("'passport_verification',new.id,new.id,policy_version");
    expect(sql).toContain("create table public.quiz_pass_attributions");
    expect(sql).toContain("references public.fan_reactions(id,app_user_id,celebrity_id)");
  });
});
