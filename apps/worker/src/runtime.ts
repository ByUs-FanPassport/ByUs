import type { Address, Hex } from "viem";
import { PinataMetadataAdapter } from "./adapters/pinata.js";
import { SupabaseQueueAdapter } from "./adapters/supabase-queue.js";
import { ViemChainAdapter } from "./adapters/viem-chain.js";
import type { WorkerEnv } from "./env.js";
import { MintWorker } from "./worker.js";

export async function runWorkerOnce(env: WorkerEnv): Promise<number> {
  const queue = SupabaseQueueAdapter.create(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const metadata = new PinataMetadataAdapter(env.PINATA_API_URL, env.PINATA_JWT);
  const chain = new ViemChainAdapter({
    rpcUrl: env.GIWA_RPC_URL,
    chainId: env.GIWA_CHAIN_ID,
    privateKey: env.GIWA_RELAYER_PRIVATE_KEY as Hex,
    passportAddress: env.BYUS_PASSPORT_CONTRACT_ADDRESS as Address,
    stampAddress: env.BYUS_STAMP_CONTRACT_ADDRESS as Address,
    deploymentBlock: env.GIWA_DEPLOYMENT_BLOCK,
  });
  const clock = { sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) };
  return new MintWorker(queue, metadata, chain, clock, {
    workerId: env.WORKER_ID,
    batchSize: env.WORKER_BATCH_SIZE,
    leaseSeconds: env.WORKER_LEASE_SECONDS,
    receiptPollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    receiptPollAttempts: env.WORKER_RECEIPT_POLL_ATTEMPTS,
    assetBaseUri: env.METADATA_ASSET_BASE_URI,
  }).runOnce();
}
