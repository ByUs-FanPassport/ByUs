import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseQueueAdapter } from "../src/adapters/supabase-queue.js";
import type { BlockchainJob } from "../src/domain.js";

const txHash = `0x${"a".repeat(64)}`;
const signedTransaction = `0x${"12".repeat(100)}`;
const row = {
  id: "82479946-5c2b-4cb7-838a-cd48f260bbcf", entity_type: "passport",
  entity_id: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c", operation_key: "passport:test",
  payload_version: 1, payload: { recipient: `0x${"1".repeat(40)}`, celebritySlug: "kara", passportId: `0x${"2".repeat(64)}` },
  attempts: 1, max_attempts: 8, tx_hash: null, lease_owner: "worker-test",
  lease_expires_at: "2099-01-01T00:00:00.000Z",
};
const job: BlockchainJob = {
  id: row.id, entityType: "passport", entityId: row.entity_id, operationKey: row.operation_key,
  payloadVersion: 1, payload: row.payload, attempts: 1, maxAttempts: 8, txHash: null,
  leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
};

describe("SupabaseQueueAdapter", () => {
  it("records prepared bytes only through the lease-checked RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: { ...row, tx_hash: txHash, payload: { ...row.payload, workerSubmission: { txHash, signedTransaction } } },
      error: null,
    }));
    const adapter = new SupabaseQueueAdapter({ rpc } as unknown as SupabaseClient);
    const result = await adapter.recordPrepared(job, { txHash, signedTransaction });
    expect(rpc).toHaveBeenCalledWith("record_prepared_blockchain_job", {
      p_job_id: job.id, p_worker_id: "worker-test", p_tx_hash: txHash,
      p_signed_transaction: signedTransaction,
    });
    expect(result.txHash).toBe(txHash);
  });

  it("does not fall back to a direct table update when the RPC rejects the lease", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "job lease is not active", code: "P0001" } }));
    const from = vi.fn();
    const adapter = new SupabaseQueueAdapter({ rpc, from } as unknown as SupabaseClient);
    await expect(adapter.recordPrepared(job, { txHash, signedTransaction })).rejects.toMatchObject({ code: "QUEUE_DATABASE_ERROR" });
    expect(from).not.toHaveBeenCalled();
  });
});
