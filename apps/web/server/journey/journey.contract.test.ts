import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260903016900_phase3_live_journey.sql",
  ),
  "utf8",
).toLowerCase();

function definition(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("Phase 3 versioned LIVE Journey database contract", () => {
  it("stores immutable requirement revisions, selected Mission versions, and one published pointer", () => {
    expect(sql).toContain("create table public.live_journey_requirement_revisions");
    expect(sql).toContain("require_passport boolean not null");
    expect(sql).toContain("require_reservation boolean not null");
    expect(sql).toContain("require_attendance boolean not null");
    expect(sql).toMatch(/bonus_ticket_amount[^\n]*(?:between 0 and 5|>= 0[^\n]*<= 5)/);
    expect(sql).toContain("create table public.live_journey_mission_requirements");
    expect(sql).toContain("mission_version");
    expect(sql).toMatch(/foreign key\s*\(mission_id,\s*live_event_id,\s*mission_version\)[\s\S]*references public\.live_surveys\s*\(id,\s*live_event_id,\s*version\)/);
    expect(sql).toMatch(/unique\s*\(live_event_id,\s*revision\)/);
    expect(sql).toMatch(/published_journey_requirement_revision_id|journey_requirement_revision_id/);
    expect(sql).toMatch(/require_passport[\s\S]*or[\s\S]*require_reservation[\s\S]*or[\s\S]*require_attendance|num_nonnulls|exists\s*\([^)]*live_journey_mission_requirements/is);
  });

  it("rejects unpublished Mission versions and stale Admin publication", () => {
    const publish = definition("publish_admin_live_journey_requirement");
    expect(publish).toMatch(/expected[^\n]*revision|p_expected_revision/);
    expect(publish).toMatch(/stale|revision_conflict|conflict/);
    expect(publish).toContain("public.live_surveys");
    expect(publish).toContain("publication_status = 'published'");
    expect(publish).toMatch(/mission[^\n]*revision|mission_version/);
    expect(publish).toContain("for update");
    expect(publish).toContain("live_effective_status_at");
    expect(publish).toMatch(/ended[\s\S]*cancelled/);
    expect(publish).toMatch(
      /require_passport[\s\S]*require_reservation[\s\S]*require_attendance[\s\S]*live_journey_mission_requirements/,
    );
    expect(publish).toMatch(/no_active_requirement|requirement_required|at least one/);
  });

  it("makes published requirements, Mission selections, participation bindings, and completions append-only", () => {
    for (const table of [
      "live_journey_requirement_revisions",
      "live_journey_mission_requirements",
      "live_journey_participations",
      "live_journey_completions",
    ]) {
      expect(sql).toMatch(
        new RegExp(`before (?:update or delete|delete or update|update|delete)[\\s\\S]*on public\\.${table}`),
      );
      expect(sql).toMatch(new RegExp(`alter table public\\.${table}[\\s\\S]*force row level security`));
    }
  });

  it("binds one fan x LIVE revision exactly once and never rewrites existing participants", () => {
    const bind = definition("bind_owned_live_journey");
    expect(sql).toContain("create table public.live_journey_participations");
    expect(sql).toMatch(/unique\s*\(app_user_id,\s*live_event_id\)/);
    expect(sql).toMatch(/on conflict\s*\(app_user_id,\s*live_event_id\)\s*do nothing/);
    expect(sql).not.toMatch(/update public\.live_journey_participations\s+set\s+requirement_revision_id/i);
    expect(bind).toContain("pg_advisory_xact_lock_shared");
    expect(bind).toContain("for share");
    expect(bind).toContain("insert into public.live_journey_participations");
    expect(bind).toMatch(/published_journey_requirement_revision_id|journey_requirement_revision_id/);
    expect(bind).toMatch(/on conflict\s*\(app_user_id,\s*live_event_id\)\s*do nothing/);
    expect(bind.indexOf("for share")).toBeLessThan(
      bind.indexOf("insert into public.live_journey_participations"),
    );
    expect(sql).toMatch(/reserve_owned_live_event[\s\S]*bind_owned_live_journey|bind_owned_live_journey[\s\S]*reserve_owned_live_event/is);
    expect(sql).toMatch(/attend_owned_live_event[\s\S]*bind_owned_live_journey|bind_owned_live_journey[\s\S]*attend_owned_live_event/is);
    expect(sql).toMatch(/submit_owned_live_mission[\s\S]*bind_owned_live_journey|bind_owned_live_journey[\s\S]*submit_owned_live_mission/is);
  });

  it("evaluates only bound active requirements from operational truth, never product events", () => {
    const evaluate = definition("evaluate_owned_live_journey");
    const project = definition("project_owned_live_journey");
    expect(evaluate).toContain("public.live_journey_participations");
    expect(evaluate).toContain("public.project_owned_live_journey");
    expect(project).toContain("public.fan_passports");
    expect(project).toContain("public.live_reservations");
    expect(project).toContain("public.live_attendances");
    expect(project).toContain("public.live_survey_responses");
    expect(project).toMatch(/require_passport[\s\S]*(?:and|or|then)/);
    expect(project).toMatch(/require_reservation[\s\S]*(?:and|or|then)/);
    expect(project).toMatch(/require_attendance[\s\S]*(?:and|or|then)/);
    expect(`${evaluate}\n${project}`).not.toMatch(/product_events|record_product_event/);
  });

  it("serializes target and replay races and produces at most one completion", () => {
    const evaluate = definition("evaluate_owned_live_journey");
    expect(evaluate).toMatch(/pg_advisory_xact_lock|for update/);
    expect(evaluate).toMatch(/journey:(?:key|idempotency)/);
    expect(evaluate).toMatch(/journey:(?:target|completion)/);
    expect(evaluate).toMatch(/idempotency_conflict/);
    expect(sql).toMatch(/unique\s*\(app_user_id,\s*live_event_id\)/);
    expect(evaluate.match(/insert into public\.live_journey_completions/g)).toHaveLength(1);
  });

  it("grants Ticket 0/3/5 correctly, snapshots policy, and never grants Score", () => {
    const evaluate = definition("evaluate_owned_live_journey");
    expect(evaluate).toContain("bonus_ticket_amount > 0");
    expect(evaluate).toContain("public.post_fan_ticket_entry");
    expect(evaluate).toContain("'journey_completion'");
    expect(evaluate).toMatch(/source_id[\s\S]*completion|completion[\s\S]*source_id/);
    expect(evaluate).toMatch(/policy_version/);
    expect(evaluate).toMatch(/reward_setting_revision_id|setting_revision/);
    expect(evaluate).not.toContain("public.fan_score_ledger");
    expect(evaluate).not.toContain("post_fan_score");
  });

  it("freezes the exact requirement truth used for each successful completion", () => {
    expect(sql).toMatch(/completion_requirement_snapshots|requirement_snapshot/);
    expect(sql).toMatch(/requirement_revision_id/);
    expect(sql).toMatch(/completed_at/);
    expect(sql).toMatch(/ticket_ledger_id/);
  });

  it("exposes only service-role SECURITY DEFINER read/evaluate boundaries", () => {
    for (const name of ["get_owned_live_journey", "evaluate_owned_live_journey"]) {
      const fn = definition(name);
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = ''");
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public,anon,authenticated`),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`),
      );
    }
  });
});
