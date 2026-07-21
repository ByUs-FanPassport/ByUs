import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721074500_g3_survey_domain.sql"), "utf8");

function definition(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("G3 survey database contract", () => {
  it("supports exactly the four confirmed question types with versioned localized snapshots", () => {
    for (const type of ["single_choice", "multiple_choice", "rating_1_5", "free_text"]) expect(sql).toContain(`'${type}'`);
    expect(sql).toContain("unique (live_event_id, version)");
    expect(sql).toContain("live_survey_question_localizations");
    expect(sql).toContain("live_survey_option_localizations");
    expect(sql).toContain("survey snapshots with responses are immutable");
    expect(sql).toContain("published survey snapshots are immutable");
    expect(sql).toContain("live_survey_common_question_key");
    for (const key of ["overall_satisfaction", "purchase_intent", "future_interest", "free_comment"]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).not.toMatch(/content_quality|interaction_quality/);
    expect(sql).toContain("not between 4 and 6");
    expect(sql).toContain("zero to two additional questions in contiguous order");
    for (const table of ["questions", "question_localizations", "options", "option_localizations"]) {
      expect(sql).toContain(`create trigger live_survey_${table}_protect_snapshot before insert or update or delete`);
    }
  });

  it("binds eligibility to an owned attendance from the exact same Live", () => {
    expect(sql).toContain("live_attendances_response_owner_unique");
    expect(sql).toContain("foreign key (attendance_id, app_user_id, live_event_id, celebrity_id)");
    expect(sql).toContain("G3_ATTENDANCE_REQUIRED");
  });

  it("keeps raw free text private", () => {
    expect(sql).toContain("live_survey_answers.free_text");
    const submit = definition("submit_owned_live_survey(");
    const payload = submit.slice(submit.indexOf("expected_payload :="), submit.indexOf("insert into public.blockchain_jobs"));
    expect(payload).not.toMatch(/free_text|freeText/);
    expect(sql).not.toMatch(/insert into public\.audit_logs[\s\S]*(?:free_text|freeText)/i);
  });

  it("atomically issues the Survey activity, +2 ledger, Stamp, and one job", () => {
    const submit = definition("submit_owned_live_survey(");
    expect(submit.match(/insert into public\.fan_activities/g)).toHaveLength(1);
    expect(submit.match(/insert into public\.fan_score_ledger/g)).toHaveLength(1);
    expect(submit.match(/insert into public\.stamps/g)).toHaveLength(1);
    expect(submit.match(/insert into public\.blockchain_jobs/g)).toHaveLength(1);
    expect(submit).toContain("'survey', 'live_survey_response'");
    expect(submit).toContain("response_record.celebrity_id, 2");
    expect(submit).toContain("'stampType', 'Survey'");
  });

  it("serializes draft and submit replay and rejects cross-operation key reuse", () => {
    for (const name of ["save_owned_live_survey_draft(", "submit_owned_live_survey("]) {
      const fn = definition(name);
      expect(fn).toContain("g3:survey:key:");
      expect(fn).toContain("g3:survey:target:");
      expect(fn).toContain("G3_SURVEY_IDEMPOTENCY_KEY_CONFLICT");
    }
  });

  it("uses an owner-visible optimistic revision to reject stale draft replacement", () => {
    const save = definition("save_owned_live_survey_draft(");
    expect(save).toContain("p_expected_revision integer");
    expect(save).toContain("response_record.revision <> p_expected_revision");
    expect(save).toContain("where id = response_record.id and revision = p_expected_revision");
    expect(save).toContain("G3_SURVEY_REVISION_CONFLICT");
    expect(definition("get_owned_live_survey(")).toContain("'revision', response.revision");
    expect(definition("build_owned_live_survey_draft_result(")).toContain("'revision', response.revision");
  });

  it("uses service-only RPCs, forced RLS, and blocks general direct mutations", () => {
    expect(sql.match(/force row level security/g)).toHaveLength(8);
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("revoke insert, update, delete, truncate on public.live_survey_responses");
    expect(sql).not.toMatch(/grant execute[\s\S]*\b(?:anon|authenticated)\b/i);
  });
});
