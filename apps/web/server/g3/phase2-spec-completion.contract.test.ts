import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260902124852_phase2_spec_completion.sql"),
  "utf8",
);

describe("Phase 2 original specification completion", () => {
  it("enforces a server-time Mission visibility window for reads and submissions", () => {
    expect(sql).toContain("visible_from timestamptz");
    expect(sql).toContain("visible_until timestamptz");
    expect(sql).toContain("statement_timestamp() >= m.visible_from");
    expect(sql).toContain("statement_timestamp() < m.visible_until");
    expect(sql).toContain("PHASE2_MISSION_NOT_VISIBLE");
  });

  it("aggregates canonical Mission participation, option, and correctness statistics", () => {
    expect(sql).toContain("create function public.get_admin_live_mission_statistics");
    expect(sql).toContain("count(distinct r.id)");
    expect(sql).toContain("selected_option_ids @> array[o.id]");
    expect(sql).toContain("'correctCount'");
    expect(sql).toContain("'incorrectCount'");
  });

  it("allows complete draft Mission settings to be updated before publication", () => {
    expect(sql).toContain("p_command in ('create','update')");
    expect(sql).toContain("draft mission not found");
    expect(sql).toContain("delete from public.live_survey_option_localizations");
  });

  it("keeps published Mission type, gates, and visibility immutable", () => {
    expect(sql).toContain("create or replace function public.reject_live_survey_snapshot_mutation");
    expect(sql).toContain("new.visible_from is not distinct from old.visible_from");
    expect(sql).toContain("new.attendance_requirement=old.attendance_requirement");
  });

  it("creates one unbound First Reaction Stamp immediately and only binds it later", () => {
    expect(sql).toContain("create function public.issue_first_reaction_stamp");
    expect(sql).toContain("after insert on public.fan_reactions");
    expect(sql).toContain("from public.fan_reactions r\njoin public.fan_activities");
    expect(sql).toContain("passport_id is null");
    expect(sql).toContain("set passport_id=new.id");
    expect(sql).toContain("on conflict(reaction_id) do nothing");
  });
});
