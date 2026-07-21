import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260721024500_g2_queue_reconciliation.sql",
);
const sql = readFileSync(migrationPath, "utf8");

function functionDefinition(name: string): string {
  const marker = `create function public.${name}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing function: ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function: ${name}`);
  return sql.slice(start, end + 4);
}

describe("G2 credential queue reconciliation static migration contract", () => {
  it("leaves every existing queue RPC definition untouched", () => {
    for (const rpc of [
      "claim_blockchain_jobs",
      "complete_blockchain_job",
      "retry_blockchain_job",
      "reclaim_stale_blockchain_jobs",
      "record_prepared_blockchain_job",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${rpc}\\b`, "i"),
      );
    }
  });

  it("validates a credential link before both insert and update", () => {
    const validator = functionDefinition("assert_credential_blockchain_job_link(");
    expect(validator).toContain("from public.blockchain_jobs");
    expect(validator).toContain("from public.celebrities");
    expect(validator).toContain("from public.user_wallets");
    expect(validator).toContain("job entity does not match credential");
    expect(validator).toContain("job payload version must be 1");
    expect(validator).toContain("job operation key does not match credential");
    expect(validator).toContain("job celebrity slug does not match credential");
    expect(validator).toContain("job recipient is not owned by credential owner");
    expect(validator).toContain("chain_id = 91342");
    expect(validator).toContain("provider = 'privy'");
    expect(validator).toContain("wallet_type = 'embedded'");
    expect(validator).toContain("credential mint status does not match queue status");
    expect(validator).toContain("job completion result does not match credential");
    expect(validator).toContain("unlinked credential must remain in canonical queued state");
    expect(validator).toContain("from jsonb_object_keys(job_payload)");
    expect(validator).toContain("from jsonb_object_keys(job_payload -> 'workerSubmission')");
    expect(validator).toContain("job passport payload is invalid");
    expect(validator).toContain("job stamp payload is invalid");
    expect(validator).toContain("job knowledge stamp type is invalid");
    expect(sql).toContain("before insert or update of blockchain_job_id, mint_status, tx_hash, token_id");
    expect(sql).toContain("create trigger fan_passports_validate_blockchain_job_link");
    expect(sql).toContain("create trigger stamps_validate_blockchain_job_link");
  });

  it("does not pretend PostgreSQL pgcrypto reproduces the canonical viem keccak boundary", () => {
    expect(sql).not.toMatch(/digest\s*\(/i);
    expect(sql).not.toMatch(/sha(?:2|3|256)/i);
    expect(sql).toContain("passportId");
    expect(sql).toContain("issuanceId");
    expect(sql).toContain("^0x[0-9a-fA-F]{64}$");
  });

  it("keeps linked job identity immutable and permits only one exact prepared-submission append", () => {
    const guard = functionDefinition("enforce_linked_blockchain_job_immutability()");
    expect(guard).toContain("linked blockchain job business identity is immutable");
    expect(guard).toContain("new.idempotency_key is distinct from old.idempotency_key");
    expect(guard).toContain(
      "linked blockchain job transaction hash conflicts with prepared submission",
    );
    expect(guard).toContain(
      "new.tx_hash is distinct from new.payload -> 'workerSubmission' ->> 'txHash'",
    );
    expect(guard).toContain("linked blockchain job payload is immutable");
    expect(guard).toContain("old.payload ? 'workerSubmission'");
    expect(guard).toContain("not (new.payload ? 'workerSubmission')");
    expect(guard).toContain("new.payload - 'workerSubmission' <> old.payload");
    expect(guard).toContain("from jsonb_object_keys(new.payload -> 'workerSubmission')");
    expect(guard).toContain("new.payload -> 'workerSubmission' ->> 'txHash' is distinct from new.tx_hash");
    expect(sql).toContain("create trigger blockchain_jobs_enforce_linked_immutability");
    expect(sql).toContain("before update on public.blockchain_jobs");
    expect(functionDefinition("enforce_blockchain_job_enqueue_payload()"))
      .toContain("worker submission can only be appended by the prepared transaction RPC");
    expect(sql).toContain("create trigger blockchain_jobs_enforce_enqueue_payload");
    expect(sql).toContain("before insert on public.blockchain_jobs");
  });

  it("reconciles every queue status after status changes and fails mismatched links", () => {
    const reconcile = functionDefinition("reconcile_credential_from_blockchain_job()");
    expect(reconcile).toContain("when 'PENDING' then 'queued'");
    expect(reconcile).toContain("when 'PROCESSING' then 'processing'");
    expect(reconcile).toContain("when 'RETRYING' then 'retryable'");
    expect(reconcile).toContain("when 'FAILED' then 'permanent_failure'");
    expect(reconcile).toContain("when 'COMPLETED' then 'minted'");
    expect(reconcile).toContain("where id = new.entity_id");
    expect(reconcile).toContain("and blockchain_job_id = new.id");
    expect(reconcile).toContain("linked blockchain job credential mismatch");
    expect(reconcile).toContain("unlinked legacy jobs are intentionally ignored");
    expect(sql).toContain("after update of status on public.blockchain_jobs");
    expect(sql).toContain("when (old.status is distinct from new.status)");
  });

  it("fails closed on existing linked data before installing triggers", () => {
    const preflightIndex = sql.indexOf("do $preflight$");
    const firstTriggerIndex = sql.indexOf("create trigger");
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(firstTriggerIndex).toBeGreaterThan(preflightIndex);
    expect(sql).toContain("existing fan passport blockchain job link is invalid");
    expect(sql).toContain("existing stamp blockchain job link is invalid");
    expect(sql.slice(preflightIndex, firstTriggerIndex)).not.toMatch(
      /update\s+public\.(?:fan_passports|stamps)\s+set/i,
    );
  });

  it("uses supported PostgreSQL JSONB key enumeration", () => {
    expect(sql).not.toContain("jsonb_object_length");
    expect(sql).toContain("from jsonb_object_keys(");
  });

  it("revokes direct execution from browser and public roles", () => {
    expect(functionDefinition("validate_credential_blockchain_job_link()"))
      .toContain("security definer");
    for (const fn of [
      "validate_credential_blockchain_job_link()",
      "enforce_linked_blockchain_job_immutability()",
      "reconcile_credential_from_blockchain_job()",
      "enforce_blockchain_job_enqueue_payload()",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated`,
      );
    }
    expect(sql).toContain("revoke all on public.blockchain_jobs from service_role");
    expect(sql).toContain("grant select on public.blockchain_jobs to service_role");
    const insertGrantStart = sql.indexOf("grant insert (");
    const insertGrantEnd = sql.indexOf(
      ") on public.blockchain_jobs to service_role",
      insertGrantStart,
    );
    expect(insertGrantStart).toBeGreaterThanOrEqual(0);
    expect(insertGrantEnd).toBeGreaterThan(insertGrantStart);
    const insertGrant = sql.slice(insertGrantStart, insertGrantEnd);
    for (const column of [
      "entity_type", "entity_id", "operation_key", "payload_version", "payload",
      "max_attempts", "idempotency_key", "next_attempt_at",
    ]) {
      expect(insertGrant).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const forbiddenColumn of [
      "status", "attempts", "tx_hash", "token_id", "lease_owner",
      "lease_expires_at", "completed_at",
    ]) {
      expect(insertGrant).not.toMatch(new RegExp(`\\b${forbiddenColumn}\\b`));
    }
    expect(sql).not.toContain("grant update on public.blockchain_jobs to service_role");
    expect(sql).not.toContain("grant delete on public.blockchain_jobs to service_role");
    expect(sql).not.toMatch(
      /grant execute on function public\.assert_credential_blockchain_job_link\([\s\S]*?\) to service_role/,
    );
  });
});
