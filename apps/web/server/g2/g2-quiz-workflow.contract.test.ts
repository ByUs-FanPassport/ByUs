import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260721040000_g2_quiz_workflow.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const submitFixSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721043000_g2_submit_generated_id_variable_fix.sql",
  ),
  "utf8",
);

function definition(name: string): string {
  const marker = `create function public.${name}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("G2 quiz workflow database contract", () => {
  it("defines only service-role owner-scoped workflow RPCs", () => {
    for (const signature of [
      "start_owned_quiz_attempt(uuid, text, uuid)",
      "get_owned_quiz_attempt(uuid, uuid)",
      "save_owned_quiz_answer(uuid, uuid, uuid, uuid)",
      "get_owned_quiz_submit_context(uuid, uuid)",
      "submit_owned_quiz_attempt(\n  uuid, uuid, uuid, text, text, text, text\n)",
    ]) {
      expect(sql).toContain(`grant execute on function public.${signature}`);
    }
    expect(sql).not.toMatch(/grant execute[\s\S]*\b(?:anon|authenticated)\b/i);
    for (const name of [
      "start_owned_quiz_attempt(",
      "get_owned_quiz_attempt(",
      "save_owned_quiz_answer(",
      "get_owned_quiz_submit_context(",
      "submit_owned_quiz_attempt(",
    ]) {
      const rpc = definition(name);
      expect(rpc).toContain("security definer");
      expect(rpc).toContain("set search_path = ''");
    }
  });

  it("randomizes exactly three source questions once and preserves option source positions", () => {
    const start = definition("start_owned_quiz_attempt(");
    expect(start).toContain("random() as random_order");
    expect(start).toContain("limit 3");
    expect(start).toContain("insert into public.quiz_attempt_questions");
    expect(start).toContain("inserted_count <> 3");
    expect(start).toContain("source_option.position");
    const optionInsert = start.slice(start.indexOf("insert into public.quiz_attempt_options"));
    expect(optionInsert).not.toContain("random()");
    expect(optionInsert).toContain(
      "order by snapshot_question.position, source_option.position, source_option.id",
    );
    expect(start).toContain("attempt.status = 'open'");
    expect(start).toContain("attempt.idempotency_key = p_idempotency_key");
  });

  it("returns an answer-free owner projection", () => {
    const projection = definition("build_owned_quiz_attempt_projection(");
    expect(projection).toContain("attempt.app_user_id = p_app_user_id");
    expect(projection).toContain("'selectedOptionId'");
    expect(projection).not.toMatch(/'isCorrect'|'is_correct'|'correctOption/i);
    expect(projection).not.toMatch(/verified_email|privy_user_id|recipient|operation_key/i);
  });

  it("saves only an owned snapshot option while holding user then attempt locks", () => {
    const save = definition("save_owned_quiz_answer(");
    const userLock = save.indexOf("from public.app_users app_user");
    const attemptLock = save.indexOf("for update;", userLock + 1);
    expect(userLock).toBeGreaterThan(-1);
    expect(attemptLock).toBeGreaterThan(userLock);
    expect(save).toContain("attempt.app_user_id = p_app_user_id");
    expect(save).toContain("question.attempt_id = p_attempt_id");
    expect(save).toContain("option.id = p_selected_option_id");
    expect(save).toContain("G2_ATTEMPT_CLOSED");
  });

  it("scores privately and requires exactly three stored answers", () => {
    const submit = definition("submit_owned_quiz_attempt(");
    expect(submit).toContain("option.is_correct");
    expect(submit).toContain("question_count <> 3 or answer_count <> 3");
    expect(submit).toContain("correct_count < 2");
    expect(submit).toContain("status = 'failed'");
    expect(submit).toContain("status = 'passed'");
    expect(submit).toContain("G2_ATTEMPT_INCOMPLETE");
  });

  it("returns terminal replay before wallet or issuance validation", () => {
    const submit = definition("submit_owned_quiz_attempt(");
    const terminal = submit.indexOf("attempt_record.status <> 'open'");
    const wallet = submit.indexOf("from public.user_wallets wallet");
    const issuanceInput = submit.indexOf("G2_ISSUANCE_INPUT_INVALID");
    expect(terminal).toBeGreaterThan(-1);
    expect(wallet).toBeGreaterThan(terminal);
    expect(issuanceInput).toBeGreaterThan(wallet);
    expect(submit.slice(terminal, wallet)).toContain("build_owned_quiz_submit_result");
  });

  it("fails terminal pass replay closed unless both credential jobs are coherent", () => {
    const result = definition("build_owned_quiz_submit_result(");
    expect(result).toContain("join public.blockchain_jobs passport_job");
    expect(result).toContain("passport_job.id = passport.blockchain_job_id");
    expect(result).toContain("passport_job.entity_type = 'passport'");
    expect(result).toContain("passport_job.entity_id = passport.id");
    expect(result).toContain("passport_job.payload_version = 1");
    expect(result).toContain("join public.blockchain_jobs stamp_job");
    expect(result).toContain("stamp_job.id = stamp.blockchain_job_id");
    expect(result).toContain("stamp_job.entity_type = 'stamp'");
    expect(result).toContain("stamp_job.entity_id = stamp.id");
    expect(result).toContain("stamp_job.payload_version = 1");
    expect(result).toContain("passport.business_status = 'issued'");
    expect(result).toContain("stamp.business_status = 'issued'");
    expect(result).toContain("passport.mint_status = case passport_job.status");
    expect(result).toContain("stamp.mint_status = case stamp_job.status");
    expect(result).toContain("passport.tx_hash = passport_job.tx_hash");
    expect(result).toContain("passport.token_id = passport_job.token_id");
    expect(result).toContain("stamp.tx_hash = stamp_job.tx_hash");
    expect(result).toContain("stamp.token_id = stamp_job.token_id");
    expect(result).toContain("G2_ISSUANCE_INCOMPLETE");
    expect(result).not.toContain("update public.");
    expect(result).not.toContain("insert into public.");
  });

  it("does not expose internal activity identity in submit results", () => {
    const result = definition("build_owned_quiz_submit_result(");
    expect(result).not.toContain("'activityId'");
    expect(result).toContain("'passportId'");
    expect(result).toContain("'stampId'");
    expect(result).toContain("'scorePoints'");
  });

  it("fails closed without the exact GIWA Privy embedded wallet", () => {
    const submit = definition("submit_owned_quiz_attempt(");
    expect(submit).toContain("chain_id = 91342");
    expect(submit).toContain("provider = 'privy'");
    expect(submit).toContain("wallet_type = 'embedded'");
    expect(submit).toContain("G2_WALLET_NOT_READY");
    expect(submit.indexOf("G2_WALLET_NOT_READY")).toBeLessThan(
      submit.indexOf("set status = 'passed'"),
    );
  });

  it("validates canonical keys and lowercase bytes32 without claiming SQL Keccak", () => {
    const submit = definition("submit_owned_quiz_attempt(");
    expect(submit).toContain("'byus:passport:v1:'");
    expect(submit).toContain("'byus:stamp:v1:'");
    expect(submit).toContain("p_passport_credential_id is null");
    expect(submit).toContain("p_stamp_issuance_id is null");
    expect(submit).toContain("^0x[0-9a-f]{64}$");
    expect(submit).not.toMatch(/digest\s*\(|sha3|keccak/i);
  });

  it("atomically creates one pass aggregate and two strict queue jobs", () => {
    const submit = definition("submit_owned_quiz_attempt(");
    for (const table of [
      "quiz_passes",
      "fan_passports",
      "fan_activities",
      "fan_score_ledger",
      "stamps",
    ]) {
      expect(submit).toContain(`insert into public.${table}`);
    }
    expect(submit.match(/insert into public\.blockchain_jobs/g)).toHaveLength(2);
    expect(submit.match(/on conflict \(operation_key\) do nothing/g)).toHaveLength(2);
    expect(submit).toContain("job_record.payload <> expected_payload");
    expect(submit).toContain("job_record.status <> 'PENDING'");
    expect(submit).toContain("G2_ISSUANCE_CONFLICT");
  });

  it("removes direct service-role mutation bypasses after the RPC boundary exists", () => {
    expect(sql).toContain("revoke insert on public.blockchain_jobs from service_role");
    expect(sql).toContain("revoke insert (\n  entity_type,");
    expect(sql).toContain("revoke insert, update, delete on public.quiz_attempt_answers from service_role");
    expect(sql).toContain("revoke update (selected_option_id, updated_at) on public.quiz_attempt_answers");
    expect(sql).toContain("on public.fan_passports from service_role");
    expect(sql).toContain("on public.stamps from service_role");
    for (const table of [
      "quiz_attempts",
      "quiz_passes",
      "fan_passports",
      "fan_activities",
      "stamps",
      "fan_score_ledger",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke[\\s\\S]{0,100}on public\\.${table} from service_role`));
    }
    expect(sql).not.toMatch(/revoke[\s\S]*celebrity_quizzes[\s\S]*service_role/i);
    expect(sql).not.toMatch(/revoke[\s\S]*claim_blockchain_jobs/i);
  });

  it("forward-replaces submit without an activity_id variable/column ambiguity", () => {
    expect(submitFixSql).toContain(
      "create or replace function public.submit_owned_quiz_attempt(",
    );
    expect(submitFixSql).toContain(
      "v_activity_id uuid := extensions.gen_random_uuid()",
    );
    expect(submitFixSql).not.toMatch(/\n\s*activity_id uuid :=/);
    expect(submitFixSql).toContain(
      "v_passport_id uuid := extensions.gen_random_uuid()",
    );
    expect(submitFixSql).toContain(
      "v_pass_id uuid := extensions.gen_random_uuid()",
    );
    expect(submitFixSql).toContain(
      "v_passport_job_id uuid := extensions.gen_random_uuid()",
    );
    expect(submitFixSql).toContain(
      "v_stamp_job_id uuid := extensions.gen_random_uuid()",
    );
    expect(submitFixSql).not.toMatch(/\n\s*passport_id uuid :=/);
    expect(submitFixSql).not.toMatch(/\n\s*pass_id uuid :=/);
    expect(submitFixSql).not.toMatch(/\n\s*passport_job_id uuid :=/);
    expect(submitFixSql).not.toMatch(/\n\s*stamp_job_id uuid :=/);
    expect(submitFixSql).toContain("where activity.id = v_activity_id");
    expect(submitFixSql).toContain("where score.activity_id = v_activity_id");
    expect(submitFixSql).toContain("and stamp.activity_id = v_activity_id");
    expect(submitFixSql).toContain("where stamp.passport_id = v_passport_id");
    expect(submitFixSql).toContain("security definer");
    expect(submitFixSql).toContain("set search_path = ''");
    expect(submitFixSql).toContain(
      "grant execute on function public.submit_owned_quiz_attempt(\n  uuid, uuid, uuid, text, text, text, text\n) to service_role",
    );
  });
});
