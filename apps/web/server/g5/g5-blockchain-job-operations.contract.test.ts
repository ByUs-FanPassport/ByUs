import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721070000_g5_blockchain_job_operations.sql"), "utf8");

describe("G5 blockchain job operations migration", () => {
  it("records immutable redacted attempt history", () => {
    expect(sql).toContain("create table public.blockchain_job_attempt_history");
    expect(sql).toContain("before update or delete on public.blockchain_job_attempt_history");
    expect(sql).toContain("before truncate on public.blockchain_job_attempt_history");
    expect(sql).toContain("safe_error_code");
    expect(sql).toContain("create function public.redact_blockchain_job_error_code");
    expect(sql).toContain("else 'UNKNOWN_JOB_ERROR'");
    expect(sql).not.toMatch(/blockchain_job_attempt_history[\s\S]{0,500}error_message/i);
  });

  it("provides a redacted admin projection without queue secrets", () => {
    const projection = sql.slice(sql.indexOf("create function public.get_admin_blockchain_jobs"), sql.indexOf("create function public.admin_retry_blockchain_job"));
    expect(projection).toContain("perform public.assert_blockchain_job_admin_actor");
    expect(projection).toContain("transaction_reference");
    expect(projection).toContain("prepared_reconciliation_required");
    expect(projection).not.toMatch(/returns table[\s\S]{0,900}\b(payload|operation_key|idempotency_key|last_error_message|lease_owner)\b/i);
    expect(projection).not.toContain("job.payload");
    expect(projection).not.toContain("job.last_error_message");
  });

  it("permits viewer reads but limits retry mutations to admin and operator", () => {
    expect(sql).toContain("if mutation_required and actor_role = 'viewer'");
    expect(sql).toContain("viewer role is read-only");
    expect(sql).toContain("job_record.status not in ('RETRYING', 'FAILED')");
    expect(sql).toContain("blockchain job reached the absolute attempt limit");
  });

  it("preserves business identity and prepared transaction reconciliation", () => {
    const retry = sql.slice(sql.indexOf("create function public.admin_retry_blockchain_job"));
    expect(retry).toContain("original_operation_key := job_record.operation_key");
    expect(retry).toContain("original_idempotency_key := job_record.idempotency_key");
    expect(retry).not.toMatch(/set[\s\S]{0,300}(operation_key|idempotency_key|payload|tx_hash)\s*=/i);
    expect(retry).toContain("prepared_reconciliation_required");
  });

  it("records the actor and correlation in immutable history and audit", () => {
    expect(sql).toContain("'admin_retry_requested'");
    expect(sql).toContain("actor_app_user_id, actor_admin_allowlist_id, correlation_id");
    expect(sql).toContain("'blockchain_job.retry_requested'");
    expect(sql).toContain("target_correlation_id");
  });

  it("keeps all new surfaces private behind service-role RPCs", () => {
    expect(sql).toContain("revoke all on public.blockchain_job_attempt_history from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function public.get_admin_blockchain_jobs");
    expect(sql).toContain("grant execute on function public.admin_retry_blockchain_job");
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|all).*blockchain_job_attempt_history/i);
  });
});
