import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721023000_g2_identity_verification.sql",
  ),
  "utf8",
);

function tableDefinition(table: string): string {
  const startMarker = `create table public.${table} (`;
  const start = sql.indexOf(startMarker);
  if (start < 0) throw new Error(`missing table definition: ${table}`);
  const end = sql.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated table definition: ${table}`);
  return sql.slice(start, end + 3);
}

const privateTables = [
  "celebrity_quizzes",
  "celebrity_quiz_questions",
  "celebrity_quiz_options",
  "quiz_attempts",
  "quiz_attempt_questions",
  "quiz_attempt_options",
  "quiz_attempt_answers",
  "quiz_passes",
  "fan_passports",
  "fan_activities",
  "stamps",
  "fan_score_ledger",
] as const;

describe("G2 identity and verification migration contract", () => {
  it.each(privateTables)(
    "keeps %s private behind RLS and browser-role revokes",
    (table) => {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `revoke all on public.${table} from public, anon, authenticated`,
      );
    },
  );

  it("keeps correct answers only in private bank and snapshot structures", () => {
    expect(tableDefinition("celebrity_quiz_options")).toContain(
      "is_correct boolean not null",
    );
    expect(tableDefinition("quiz_attempt_options")).toContain(
      "is_correct boolean not null",
    );
    expect(sql).not.toMatch(/create (?:or replace )?view[\s\S]*is_correct/i);
    expect(sql).not.toMatch(/grant select on public\.(?:celebrity_quiz_options|quiz_attempt_options) to (?:anon|authenticated)/i);
  });

  it("allows publication only with at least three valid active questions", () => {
    expect(sql).toContain("create function public.assert_quiz_publishable(target_id uuid)");
    expect(sql).toContain("published quiz requires at least three active questions");
    expect(sql).toContain("published quiz questions require at least two active options and exactly one correct option");
    expect(sql).toContain("create constraint trigger celebrity_quizzes_validate_publication");
    expect(sql).toContain("create constraint trigger celebrity_quiz_options_validate_publication");
    expect(sql).toContain("published quiz versions are immutable; create a new version");
    expect(sql).toContain("perform public.assert_quiz_publishable(old.quiz_id)");
    expect(sql).toContain("perform public.assert_quiz_publishable(new.quiz_id)");
    expect(sql).toContain("perform public.assert_quiz_publishable(old_target_quiz_id)");
    expect(sql).toContain("perform public.assert_quiz_publishable(new_target_quiz_id)");
  });

  it("makes attempt identity immutable and permits exactly one terminal transition", () => {
    expect(sql).toContain("create function public.enforce_quiz_attempt_transition()");
    expect(sql).toContain("quiz attempt identity is immutable");
    expect(sql).toContain("terminal quiz attempt is immutable");
    expect(sql).toContain("quiz attempt transition must be open to passed or failed");
    expect(sql).toContain("winning attempt must be passed and owned by the quiz pass");
  });

  it("blocks snapshot and answer mutations after an attempt is terminal", () => {
    expect(sql).toContain("create function public.enforce_open_attempt_snapshot_mutation()");
    expect(sql).toContain("quiz snapshot is immutable after attempt submission");
    expect(sql).toContain("create trigger quiz_attempt_questions_require_open_attempt");
    expect(sql).toContain("create trigger quiz_attempt_options_require_open_attempt");
    expect(sql).toContain("create trigger quiz_attempt_answers_require_open_attempt");
    expect(sql).toContain(
      "future atomic submit RPC must validate exactly three snapshot questions before terminal transition",
    );
    expect(sql).not.toContain(
      "grant update (status, score, submitted_at, updated_at) on public.quiz_attempts to service_role",
    );
  });

  it("allows service-role administration without granting destructive access to issued records", () => {
    expect(sql).toContain(
      "grant select, insert, update, delete on public.celebrity_quizzes to service_role",
    );
    expect(sql).toContain("grant select, insert on public.fan_passports to service_role");
    expect(sql).toContain(
      "grant update (mint_status, blockchain_job_id, tx_hash, token_id, updated_at) on public.fan_passports to service_role",
    );
    expect(sql).toContain(
      "grant select, insert on public.fan_score_ledger to service_role",
    );
    expect(sql).not.toContain(
      "grant select, insert, update, delete on public.fan_passports to service_role",
    );
    expect(sql).not.toContain("grant all on public.fan_score_ledger");
  });

  it("enforces the closed activity score weights at the database boundary", () => {
    expect(sql).toContain("knowledge' then 1");
    expect(sql).toContain("reservation' then 1");
    expect(sql).toContain("attendance' then 3");
    expect(sql).toContain("survey' then 2");
    expect(sql).toContain("fan score points do not match activity type");
    expect(sql).toContain("fan_score_ledger_append_only");
    expect(sql).toContain("knowledge activity must reference an owned quiz pass");
    expect(sql).toContain("knowledge stamp requires a knowledge activity");
    expect(sql).toContain("fan activity is append-only");
    expect(sql).toContain("create trigger fan_activities_append_only");
    expect(sql).toContain("create trigger stamps_validate_knowledge_activity_update");
    expect(sql).toContain("create trigger fan_score_ledger_00_validate_weight_update");
  });

  it("uses composite foreign keys to keep pass, stamp, and ledger ownership coherent", () => {
    expect(tableDefinition("quiz_attempt_questions")).toMatch(
      /foreign key \(attempt_id, quiz_id\)[\s\S]*references public\.quiz_attempts \(id, quiz_id\)/,
    );
    expect(tableDefinition("quiz_attempt_questions")).toMatch(
      /foreign key \(source_question_id, quiz_id\)[\s\S]*references public\.celebrity_quiz_questions \(id, quiz_id\)/,
    );
    expect(tableDefinition("quiz_attempt_options")).toMatch(
      /foreign key \(source_option_id, source_question_id\)[\s\S]*references public\.celebrity_quiz_options \(id, question_id\)/,
    );
    expect(tableDefinition("quiz_passes")).toMatch(
      /foreign key \(winning_attempt_id, app_user_id, celebrity_id\)[\s\S]*references public\.quiz_attempts \(id, app_user_id, celebrity_id\)/,
    );
    expect(tableDefinition("fan_passports")).toMatch(
      /foreign key \(quiz_pass_id, app_user_id, celebrity_id\)[\s\S]*references public\.quiz_passes \(id, app_user_id, celebrity_id\)/,
    );
    expect(tableDefinition("fan_score_ledger")).toMatch(
      /foreign key \(activity_id, app_user_id, celebrity_id\)[\s\S]*references public\.fan_activities \(id, app_user_id, celebrity_id\)/,
    );
    expect(tableDefinition("stamps")).toMatch(
      /foreign key \(passport_id, app_user_id, celebrity_id\)[\s\S]*references public\.fan_passports \(id, app_user_id, celebrity_id\)/,
    );
  });

  it("keeps issued business state separate from internally consistent mint state", () => {
    expect(sql).toContain(
      "create type public.credential_mint_status as enum ('queued', 'processing', 'minted', 'retryable', 'permanent_failure')",
    );
    for (const table of ["fan_passports", "stamps"]) {
      const definition = tableDefinition(table);
      expect(definition).toContain(
        "business_status text not null default 'issued' check (business_status = 'issued')",
      );
      expect(definition).toMatch(/mint_status = 'minted'[\s\S]*tx_hash is not null[\s\S]*token_id is not null/);
      expect(definition).toMatch(/mint_status <> 'minted'[\s\S]*tx_hash is null[\s\S]*token_id is null/);
      expect(definition).toContain("tx_hash ~ '^0x[0-9a-fA-F]{64}$'");
      expect(definition).toContain("token_id > 0");
    }
    expect(tableDefinition("fan_passports")).toContain(
      "fan_passports_mint_result_consistent",
    );
    expect(tableDefinition("stamps")).toContain(
      "stamps_mint_result_consistent",
    );
    expect(sql).toContain("credential identity and business fields are immutable");
    expect(sql).toContain("invalid credential mint status transition");
    expect(sql).toContain("minted credential is immutable");
    expect(sql).toContain("create trigger fan_passports_enforce_update");
    expect(sql).toContain("create trigger stamps_enforce_update");
  });

  it("prevents celebrity slug changes after G2 or job references exist", () => {
    expect(sql).toContain("create function public.prevent_referenced_celebrity_slug_change()");
    expect(sql).toContain("celebrity slug is immutable after it is referenced");
    expect(sql).toContain("from public.quiz_attempts");
    expect(sql).toContain("from public.fan_passports");
    expect(sql).toContain("from public.fan_activities");
    expect(sql).toContain("from public.blockchain_jobs");
    expect(sql).toContain("create trigger celebrities_preserve_referenced_slug");
  });
});
