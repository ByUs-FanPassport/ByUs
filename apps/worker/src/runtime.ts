import type { Address, Hex } from "viem";
import { PinataMetadataAdapter } from "./adapters/pinata.js";
import { SupabaseQueueAdapter } from "./adapters/supabase-queue.js";
import { ViemChainAdapter } from "./adapters/viem-chain.js";
import type { WorkerEnv } from "./env.js";
import { MintWorker } from "./worker.js";

export async function runWorkerOnce(env: WorkerEnv): Promise<number> {
  const collectibleEnabled = Boolean(env.BYUS_COLLECTIBLE_CONTRACT_ADDRESS && env.GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK !== undefined);
  const communityStampEnabled = env.WORKER_CAPABILITY_VERSION === "community-stamp-v1";
  const supportedEntityTypes = ["passport", "stamp", "reaction"];
  if (collectibleEnabled) supportedEntityTypes.push("collectible");
  if (communityStampEnabled) supportedEntityTypes.push("community_stamp");
  const queue = SupabaseQueueAdapter.create(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    supportedEntityTypes);
  const metadata = new PinataMetadataAdapter(env.PINATA_API_URL, env.PINATA_JWT);
  const chain = new ViemChainAdapter({
    rpcUrl: env.GIWA_RPC_URL,
    chainId: env.GIWA_CHAIN_ID,
    privateKey: env.GIWA_RELAYER_PRIVATE_KEY as Hex,
    passportAddress: env.BYUS_PASSPORT_CONTRACT_ADDRESS as Address,
    stampAddress: env.BYUS_STAMP_CONTRACT_ADDRESS as Address,
    deploymentBlock: env.GIWA_DEPLOYMENT_BLOCK,
    feePolicy: {
      maxGas: env.GIWA_MINT_MAX_GAS,
      maxFeePerGasWei: env.GIWA_MINT_MAX_FEE_PER_GAS_WEI,
      maxPriorityFeePerGasWei: env.GIWA_MINT_MAX_PRIORITY_FEE_PER_GAS_WEI,
      maxExecutionFeeWei: env.GIWA_MINT_MAX_EXECUTION_FEE_WEI,
    },
    ...(env.BYUS_COLLECTIBLE_CONTRACT_ADDRESS && env.GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK !== undefined
      ? {
          collectibleAddress: env.BYUS_COLLECTIBLE_CONTRACT_ADDRESS as Address,
          collectibleDeploymentBlock: env.GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK,
        }
      : {}),
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
