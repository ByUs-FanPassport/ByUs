import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260721031500_g2_attempt_locking.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("G2 attempt snapshot locking migration contract", () => {
  it("replaces only the existing snapshot guard through an additive migration", () => {
    expect(sql).toContain(
      "create or replace function public.enforce_open_attempt_snapshot_mutation()",
    );
    expect(sql).not.toMatch(/create\s+(?:or\s+replace\s+)?trigger\b/i);
    expect(sql).not.toMatch(/alter\s+table\b/i);
  });

  it("resolves the real parent attempt for every guarded snapshot relation", () => {
    expect(sql).toContain("tg_table_name = 'quiz_attempt_questions'");
    expect(sql).toContain("tg_table_name = 'quiz_attempt_options'");
    expect(sql).toContain("tg_table_name = 'quiz_attempt_answers'");
    expect(sql).toContain("from public.quiz_attempt_questions question");
    expect(sql).toContain("where question.id = old.attempt_question_id");
    expect(sql).toContain("where question.id = new.attempt_question_id");
    expect(sql).toContain("unsupported quiz attempt snapshot relation");
  });

  it("fails closed for missing questions, attempts, and canonical owners", () => {
    expect(sql).toContain("quiz snapshot parent question does not exist");
    expect(sql).toContain("quiz snapshot parent attempt does not exist");
    expect(sql).toContain("quiz snapshot parent owner does not exist");
    expect(sql).toContain("locked_row_count <> expected_attempt_count");
    expect(sql).toContain("locked_row_count <> expected_owner_count");
  });

  it("locks owners then attempts in deterministic order before checking open state", () => {
    const ownerLock = sql.indexOf("from public.app_users app_user");
    const attemptLock = sql.indexOf("for update;", ownerLock);
    const openCheck = sql.indexOf("attempt.status <> 'open'", attemptLock);

    expect(ownerLock).toBeGreaterThan(-1);
    expect(sql.slice(ownerLock, attemptLock)).toContain("order by app_user.id");
    expect(sql.slice(ownerLock, attemptLock)).toContain("for key share");
    expect(attemptLock).toBeGreaterThan(ownerLock);
    expect(sql.slice(attemptLock - 180, attemptLock)).toContain("order by attempt.id");
    expect(openCheck).toBeGreaterThan(attemptLock);
    expect(sql).toContain("quiz snapshot is immutable after attempt submission");
  });

  it("keeps the trigger helper unavailable to browser roles", () => {
    expect(sql).toMatch(
      /revoke all on function public\.enforce_open_attempt_snapshot_mutation\(\)\s+from public, anon, authenticated;/,
    );
    expect(sql).not.toMatch(/grant execute[\s\S]*\b(?:anon|authenticated)\b/i);
  });
});
