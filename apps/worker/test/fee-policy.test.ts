import { describe, expect, it } from "vitest";
import { assertMintFeePolicy, DEFAULT_MINT_FEE_POLICY, validateMintFeePolicy } from "../src/fee-policy.js";

const candidate = {
  type: "eip1559",
  gas: 200_000n,
  maxFeePerGas: 1_000_000n,
  maxPriorityFeePerGas: 1_000_000n,
} as const;

describe("mint fee policy", () => {
  it("accepts the configured boundaries", () => {
    expect(() => assertMintFeePolicy({
      type: "eip1559",
      gas: DEFAULT_MINT_FEE_POLICY.maxGas,
      maxFeePerGas: DEFAULT_MINT_FEE_POLICY.maxFeePerGasWei,
      maxPriorityFeePerGas: DEFAULT_MINT_FEE_POLICY.maxPriorityFeePerGasWei,
    }, DEFAULT_MINT_FEE_POLICY)).not.toThrow();
  });

  it.each([
    { ...candidate, gas: DEFAULT_MINT_FEE_POLICY.maxGas + 1n },
    { ...candidate, maxFeePerGas: DEFAULT_MINT_FEE_POLICY.maxFeePerGasWei + 1n },
    { ...candidate, maxPriorityFeePerGas: DEFAULT_MINT_FEE_POLICY.maxPriorityFeePerGasWei + 1n },
    { ...candidate, gas: 1_000_000n, maxFeePerGas: 100_000_001n },
    { ...candidate, type: "legacy" },
    { ...candidate, maxFeePerGas: undefined },
  ])("blocks an unsupported or over-limit transaction without exposing fee details", (transaction) => {
    expect(() => assertMintFeePolicy(transaction, DEFAULT_MINT_FEE_POLICY)).toThrow(expect.objectContaining({
      code: "MINT_FEE_POLICY_BLOCKED",
      message: "Mint transaction is temporarily blocked by fee policy",
      retryable: true,
    }));
  });

  it("enforces the aggregate execution fee independently of the individual caps", () => {
    const policy = validateMintFeePolicy({
      maxGas: 1_000_000n,
      maxFeePerGasWei: 200_000_000n,
      maxPriorityFeePerGasWei: 100_000_000n,
      maxExecutionFeeWei: 100_000_000_000_000n,
    });
    expect(() => assertMintFeePolicy({
      type: "eip1559",
      gas: 1_000_000n,
      maxFeePerGas: 100_000_001n,
      maxPriorityFeePerGas: 1_000_000n,
    }, policy)).toThrow(expect.objectContaining({ code: "MINT_FEE_POLICY_BLOCKED" }));
  });

  it.each([
    { ...DEFAULT_MINT_FEE_POLICY, maxGas: 0n },
    { ...DEFAULT_MINT_FEE_POLICY, maxFeePerGasWei: -1n },
    { ...DEFAULT_MINT_FEE_POLICY, maxPriorityFeePerGasWei: 0n },
    { ...DEFAULT_MINT_FEE_POLICY, maxExecutionFeeWei: 0n },
    { ...DEFAULT_MINT_FEE_POLICY, maxFeePerGasWei: 10n, maxPriorityFeePerGasWei: 11n },
  ])("rejects an invalid policy configuration", (policy) => {
    expect(() => validateMintFeePolicy(policy)).toThrow("Invalid mint fee policy configuration");
  });
});
