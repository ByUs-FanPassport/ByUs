import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BlockchainJobRepositoryError, createSupabaseBlockchainJobRepository } from "./blockchain-job-repository";

const actor = { appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222" };

describe("blockchain job repository", () => {
  it("maps only the redacted RPC projection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      id: "33333333-3333-4333-8333-333333333333", entity_type: "stamp", entity_id: "44444444-4444-4444-8444-444444444444",
      status: "FAILED", attempts: 8, max_attempts: 8, next_attempt_at: "2026-07-21T00:00:00Z",
      created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-21T00:00:00Z", completed_at: null,
      transaction_reference: "0x12345678…abcdef00", chain_state: "prepared_reconciliation_required",
      safe_error_code: "GIWA_RPC_READ_FAILED", safe_error_summary: "Chain provider operation requires review.",
      manually_retryable: true, attempt_history: [],
    }], error: null });
    const repository = createSupabaseBlockchainJobRepository({ url: "https://db.test", serviceRoleKey: "secret" }, { rpc } as never);
    const jobs = await repository.list({ actor, jobId: null, status: "FAILED", limit: 50, beforeCreatedAt: null });

    expect(rpc).toHaveBeenCalledWith("get_admin_blockchain_jobs", expect.objectContaining({
      target_actor_app_user_id: actor.appUserId,
      target_actor_admin_allowlist_id: actor.allowlistId,
      target_status: "FAILED",
    }));
    expect(jobs[0]).toMatchObject({ status: "FAILED", transactionReference: "0x12345678…abcdef00", errorCode: "GIWA_RPC_READ_FAILED" });
    expect(JSON.stringify(jobs)).not.toMatch(/recipient|signedTransaction|private|last_error_message/i);
  });

  it("returns the accepted retry without changing identifiers in application code", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      id: "33333333-3333-4333-8333-333333333333", status: "RETRYING", attempts: 8,
      max_attempts: 9, next_attempt_at: "2026-07-21T00:00:00Z", chain_state: "prepared_reconciliation_required",
    }], error: null });
    const repository = createSupabaseBlockchainJobRepository({ url: "https://db.test", serviceRoleKey: "secret" }, { rpc } as never);
    await expect(repository.retry({ actor, jobId: "33333333-3333-4333-8333-333333333333", correlationId: "55555555-5555-4555-8555-555555555555" }))
      .resolves.toMatchObject({ status: "RETRYING", maxAttempts: 9, chainState: "prepared_reconciliation_required" });
  });

  it("classifies expected retry conflicts without exposing database text", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "only retryable or failed blockchain jobs can be retried" } });
    const repository = createSupabaseBlockchainJobRepository({ url: "https://db.test", serviceRoleKey: "secret" }, { rpc } as never);
    await expect(repository.retry({ actor, jobId: "33333333-3333-4333-8333-333333333333", correlationId: "55555555-5555-4555-8555-555555555555" }))
      .rejects.toEqual(new BlockchainJobRepositoryError("NOT_RETRYABLE"));
  });
});
