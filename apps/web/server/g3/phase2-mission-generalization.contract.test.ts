import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260902025000_phase2_mission_generalization.sql"),"utf8");
describe("Phase 2 Mission generalization",()=>{
  it("keeps legacy Survey while allowing many typed Missions per LIVE",()=>{
    expect(sql).toContain("mission_type text not null default 'survey'");
    expect(sql).toContain("legacy_contract boolean not null default true");
    expect(sql).toContain("where publication_status='published' and legacy_contract");
    expect(sql).toContain("live_survey_responses_one_per_mission");
  });
  it("supports conditional attendance, media, and correctness",()=>{
    expect(sql).toContain("attendance_requirement text");
    expect(sql).toContain("media_type text");
    expect(sql).toContain("correct_option_id uuid");
    expect(sql).toContain("correctness boolean");
  });
  it("creates all business effects and configured rewards in one submit RPC",()=>{
    const body=sql.slice(sql.indexOf("create function public.submit_owned_live_mission"),sql.indexOf("create function public.admin_write_live_mission"));
    expect(body).toContain("insert into public.live_survey_responses");
    expect(body).toContain("insert into public.fan_activities");
    expect(body).toContain("if reward_setting.mission_score>0");
    expect(body).toContain("post_fan_ticket_entry");
    expect(body).toContain("insert into public.blockchain_jobs");
    expect(body).toContain("insert into public.stamps");
  });
});
