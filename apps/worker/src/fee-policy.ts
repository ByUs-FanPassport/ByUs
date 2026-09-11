import { WorkerError } from "./domain.js";

export interface MintFeePolicy {
  maxGas: bigint;
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  maxExecutionFeeWei: bigint;
}

export const DEFAULT_MINT_FEE_POLICY: MintFeePolicy = {
  maxGas: 1_000_000n,
  maxFeePerGasWei: 100_000_000n,
  maxPriorityFeePerGasWei: 100_000_000n,
  maxExecutionFeeWei: 100_000_000_000_000n,
};

interface MintFeeCandidate {
  type: string | undefined;
  gas: bigint | undefined;
  maxFeePerGas: bigint | undefined;
  maxPriorityFeePerGas: bigint | undefined;
}

export function validateMintFeePolicy(policy: MintFeePolicy): MintFeePolicy {
  if (
    policy.maxGas <= 0n
    || policy.maxFeePerGasWei <= 0n
    || policy.maxPriorityFeePerGasWei <= 0n
    || policy.maxExecutionFeeWei <= 0n
    || policy.maxPriorityFeePerGasWei > policy.maxFeePerGasWei
  ) {
    throw new Error("Invalid mint fee policy configuration");
  }
  return policy;
}

export function assertMintFeePolicy(candidate: MintFeeCandidate, policy: MintFeePolicy): void {
  validateMintFeePolicy(policy);
  const { gas, maxFeePerGas, maxPriorityFeePerGas } = candidate;
  if (
    candidate.type !== "eip1559"
    || gas === undefined
    || maxFeePerGas === undefined
    || maxPriorityFeePerGas === undefined
    || gas <= 0n
    || maxFeePerGas <= 0n
    || maxPriorityFeePerGas <= 0n
    || maxPriorityFeePerGas > maxFeePerGas
    || gas > policy.maxGas
    || maxFeePerGas > policy.maxFeePerGasWei
    || maxPriorityFeePerGas > policy.maxPriorityFeePerGasWei
    || gas * maxFeePerGas > policy.maxExecutionFeeWei
  ) {
    throw new WorkerError("MINT_FEE_POLICY_BLOCKED", "Mint transaction is temporarily blocked by fee policy", true);
  }
}
