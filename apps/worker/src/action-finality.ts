import { createPublicClient, defineChain, getAddress, http, type Address, type Hash, type PublicClient } from "viem";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WorkerError } from "./domain.js";
import { canonicalActionPayloadV1Schema } from "./action-domain.js";
import type { ActionChainPort, ActionReceipt } from "./action-ports.js";

export type ChainInclusionStatus = "included" | "safe" | "finalized" | "orphaned";

export interface StoredActionReceipt {
  jobId: string;
  payload: unknown;
  receipt: { txHash: string; blockNumber: string; blockHash: string };
  inclusionStatus: ChainInclusionStatus;
}

export interface ActionReceiptIndexPort {
  list(limit: number, afterJobId?: string): Promise<StoredActionReceipt[]>;
  setFinality(jobId: string, expectedBlockHash: string, status: ChainInclusionStatus): Promise<boolean>;
  replaceReceipt(jobId: string, expectedBlockHash: string, receipt: ActionReceipt): Promise<boolean>;
}

export interface ActionFinalityPort {
  classify(receipt: StoredActionReceipt["receipt"]): Promise<ChainInclusionStatus>;
}

export class ActionFinalityReconciler {
  constructor(private readonly index: ActionReceiptIndexPort, private readonly chain: ActionFinalityPort, private readonly recovery?: ActionChainPort) {}

  async runOnce(limit = 100): Promise<number> {
    let after: string | undefined;
    let processed = 0;
    while (true) {
      const rows = await this.index.list(limit, after);
      for (const row of rows) {
        const status = await this.chain.classify(row.receipt);
        if (status !== row.inclusionStatus) await this.index.setFinality(row.jobId, row.receipt.blockHash, status);
        if (status === "orphaned" && this.recovery) {
          const payload = canonicalActionPayloadV1Schema.parse(row.payload);
          const recovered = await this.recovery.findExisting(payload);
          if (recovered && recovered.blockHash.toLowerCase() !== row.receipt.blockHash.toLowerCase()) {
            await this.index.replaceReceipt(row.jobId, row.receipt.blockHash, recovered);
          }
        }
        processed += 1;
      }
      if (rows.length < limit) return processed;
      after = rows.at(-1)!.jobId;
    }
  }
}

type Row = Record<string, unknown>;
function dbError(operation: string, error: { message: string; code?: string }): WorkerError {
  return new WorkerError("ACTION_FINALITY_DATABASE_ERROR", `${operation}: ${error.message}`, true, { cause: error });
}

export class SupabaseActionReceiptIndex implements ActionReceiptIndexPort {
  constructor(private readonly client: SupabaseClient) {}
  static create(url: string, serviceRoleKey: string): SupabaseActionReceiptIndex {
    return new SupabaseActionReceiptIndex(createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  }
  async list(limit: number, afterJobId?: string): Promise<StoredActionReceipt[]> {
    const { data, error } = await this.client.rpc("list_fan_action_receipts", { p_limit: limit, p_after_job_id: afterJobId ?? null });
    if (error) throw dbError("list_fan_action_receipts", error);
    return ((data ?? []) as Row[]).map((row) => ({
      jobId: String(row.job_id),
      payload: row.payload,
      receipt: row.receipt as StoredActionReceipt["receipt"],
      inclusionStatus: row.inclusion_status as ChainInclusionStatus,
    }));
  }
  async setFinality(jobId: string, expectedBlockHash: string, status: ChainInclusionStatus): Promise<boolean> {
    const { data, error } = await this.client.rpc("set_fan_action_finality", { p_job_id: jobId, p_expected_block_hash: expectedBlockHash, p_status: status });
    if (error) throw dbError("set_fan_action_finality", error);
    return data === true;
  }
  async replaceReceipt(jobId: string, expectedBlockHash: string, receipt: ActionReceipt): Promise<boolean> {
    const normalized = {
      txHash: receipt.txHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      transactionIndex: receipt.transactionIndex, hubLogIndex: receipt.hubLogIndex, easUid: receipt.easUid,
      recordHash: receipt.recordHash, credentialRefsHash: receipt.credentialRefsHash,
      credentials: receipt.credentials.map((item) => ({ ...item, tokenId: item.tokenId.toString() })), inclusionStatus: "included",
    };
    const { data, error } = await this.client.rpc("replace_fan_action_receipt", { p_job_id: jobId, p_expected_block_hash: expectedBlockHash, p_receipt: normalized });
    if (error) throw dbError("replace_fan_action_receipt", error);
    return data === true;
  }
}

export class ViemActionFinalityReader implements ActionFinalityPort {
  private readonly client: PublicClient;
  constructor(options: { rpcUrl: string; chainId: number; client?: PublicClient }) {
    const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
    this.client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl) });
  }
  async classify(stored: StoredActionReceipt["receipt"]): Promise<ChainInclusionStatus> {
    let current;
    try {
      current = await this.client.getTransactionReceipt({ hash: stored.txHash as Hash });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (message.includes("not found") || message.includes("could not be found")) return "orphaned";
      throw error;
    }
    if (current.blockHash.toLowerCase() !== stored.blockHash.toLowerCase() || current.blockNumber !== BigInt(stored.blockNumber)) return "orphaned";
    const canonical = await this.client.getBlock({ blockNumber: current.blockNumber });
    if (canonical.hash?.toLowerCase() !== current.blockHash.toLowerCase()) return "orphaned";
    const [safe, finalized] = await Promise.allSettled([
      this.client.getBlock({ blockTag: "safe" }),
      this.client.getBlock({ blockTag: "finalized" }),
    ]);
    if (finalized.status === "fulfilled" && finalized.value.number >= current.blockNumber) return "finalized";
    if (safe.status === "fulfilled" && safe.value.number >= current.blockNumber) return "safe";
    return "included";
  }
}
