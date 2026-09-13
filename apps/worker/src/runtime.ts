import type { Address, Hex } from "viem";
import { randomUUID } from "node:crypto";
import { PinataMetadataAdapter } from "./adapters/pinata.js";
import { SupabaseQueueAdapter } from "./adapters/supabase-queue.js";
import { ViemChainAdapter } from "./adapters/viem-chain.js";
import type { WorkerEnv } from "./env.js";
import { MintWorker } from "./worker.js";
import { ActionWorker } from "./action-worker.js";
import { SupabaseActionQueueAdapter } from "./adapters/supabase-action-queue.js";
import { ViemActionHubAdapter } from "./adapters/viem-action-hub.js";
import { ActionFinalityReconciler, SupabaseActionReceiptIndex, ViemActionFinalityReader } from "./action-finality.js";

export async function runWorkerOnce(env: WorkerEnv): Promise<number> {
  const invocationWorkerId = `${env.WORKER_ID.slice(0, 80)}:${randomUUID()}`;
  const collectibleEnabled = Boolean(env.BYUS_COLLECTIBLE_CONTRACT_ADDRESS && env.GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK !== undefined);
  const communityStampEnabled = env.WORKER_CAPABILITY_VERSION === "community-stamp-v1" || env.WORKER_CAPABILITY_VERSION === "action-ledger-v1";
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
  const legacyClaimed = await new MintWorker(queue, metadata, chain, clock, {
    workerId: invocationWorkerId,
    batchSize: env.WORKER_BATCH_SIZE,
    leaseSeconds: env.WORKER_LEASE_SECONDS,
    receiptPollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    receiptPollAttempts: env.WORKER_RECEIPT_POLL_ATTEMPTS,
    assetBaseUri: env.METADATA_ASSET_BASE_URI,
  }).runOnce();
  if (env.WORKER_CAPABILITY_VERSION !== "action-ledger-v1") return legacyClaimed;
  const actionQueue = SupabaseActionQueueAdapter.create(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const actionChain = new ViemActionHubAdapter({
    rpcUrl: env.GIWA_RPC_URL,
    chainId: env.GIWA_CHAIN_ID,
    privateKey: env.GIWA_RELAYER_PRIVATE_KEY as Hex,
    hubAddress: env.BYUS_ACTION_HUB_CONTRACT_ADDRESS as Address,
    deploymentBlock: env.GIWA_ACTION_HUB_DEPLOYMENT_BLOCK!,
    feePolicy: {
      maxGas: env.GIWA_MINT_MAX_GAS,
      maxFeePerGasWei: env.GIWA_MINT_MAX_FEE_PER_GAS_WEI,
      maxPriorityFeePerGasWei: env.GIWA_MINT_MAX_PRIORITY_FEE_PER_GAS_WEI,
      maxExecutionFeeWei: env.GIWA_MINT_MAX_EXECUTION_FEE_WEI,
    },
  });
  const actionClaimed = await new ActionWorker(actionQueue, metadata, actionChain, clock, {
    workerId: invocationWorkerId,
    batchSize: env.WORKER_BATCH_SIZE,
    leaseSeconds: env.WORKER_LEASE_SECONDS,
    receiptPollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    receiptPollAttempts: env.WORKER_RECEIPT_POLL_ATTEMPTS,
  }).runOnce();
  await new ActionFinalityReconciler(
    SupabaseActionReceiptIndex.create(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
    new ViemActionFinalityReader({ rpcUrl: env.GIWA_RPC_URL, chainId: env.GIWA_CHAIN_ID }),
    actionChain,
  ).runOnce();
  return legacyClaimed + actionClaimed;
}

/** Explicit migration lane. Call only with a separately authorized MIGRATOR key. */
export async function runHistoricalActionWorkerOnce(env: WorkerEnv, migratorPrivateKey: Hex): Promise<number> {
  if (!env.BYUS_ACTION_HUB_CONTRACT_ADDRESS || env.GIWA_ACTION_HUB_DEPLOYMENT_BLOCK === undefined) {
    throw new Error("Historical action execution requires an explicit ActionHub binding");
  }
  if (migratorPrivateKey.toLowerCase() === (env.GIWA_RELAYER_PRIVATE_KEY as string).toLowerCase()) {
    throw new Error("Historical migration must use a separate MIGRATOR account");
  }
  const invocationWorkerId = `${env.WORKER_ID.slice(0, 70)}:migration:${randomUUID()}`;
  const queue = SupabaseActionQueueAdapter.create(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, ["import_historical"]);
  const metadata = new PinataMetadataAdapter(env.PINATA_API_URL, env.PINATA_JWT);
  const chain = new ViemActionHubAdapter({
    rpcUrl: env.GIWA_RPC_URL, chainId: env.GIWA_CHAIN_ID, privateKey: migratorPrivateKey,
    hubAddress: env.BYUS_ACTION_HUB_CONTRACT_ADDRESS as Address,
    deploymentBlock: env.GIWA_ACTION_HUB_DEPLOYMENT_BLOCK,
    feePolicy: { maxGas: env.GIWA_MINT_MAX_GAS, maxFeePerGasWei: env.GIWA_MINT_MAX_FEE_PER_GAS_WEI, maxPriorityFeePerGasWei: env.GIWA_MINT_MAX_PRIORITY_FEE_PER_GAS_WEI, maxExecutionFeeWei: env.GIWA_MINT_MAX_EXECUTION_FEE_WEI },
  });
  const clock = { sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) };
  return new ActionWorker(queue, metadata, chain, clock, {
    workerId: invocationWorkerId, batchSize: env.WORKER_BATCH_SIZE, leaseSeconds: env.WORKER_LEASE_SECONDS,
    receiptPollIntervalMs: env.WORKER_POLL_INTERVAL_MS, receiptPollAttempts: env.WORKER_RECEIPT_POLL_ATTEMPTS,
  }).runOnce();
}
