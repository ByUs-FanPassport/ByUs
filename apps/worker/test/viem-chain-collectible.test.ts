import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, stringToHex, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ViemChainAdapter } from "../src/adapters/viem-chain.js";
import type { CollectiblePayloadV1 } from "../src/domain.js";

const privateKey = `0x${"1".repeat(64)}` as Hex;
const contract = `0x${"2".repeat(40)}` as Address;
const recipient = `0x${"3".repeat(40)}` as Address;
const claimId = "3ff058e6-8865-46c5-ae01-94a93f1dbe3c";
const claimKey = keccak256(stringToHex(claimId));
const abi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "claimKey", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] }] as const;
const eventAbi = [{ type: "event", name: "CollectibleMinted", inputs: [{ indexed: true, name: "claimKey", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] }] as const;

async function submission(metadataUri = "ipfs://expected") {
  const signedTransaction = await privateKeyToAccount(privateKey).signTransaction({
    chainId: 91342, type: "eip1559", to: contract, nonce: 0, gas: 200000n,
    maxFeePerGas: 1n, maxPriorityFeePerGas: 1n,
    data: encodeFunctionData({ abi, functionName: "mint", args: [recipient, claimKey, metadataUri] }),
  });
  return { txHash: keccak256(signedTransaction), signedTransaction };
}

function adapter(client: unknown) {
  return new ViemChainAdapter({ rpcUrl: "https://rpc.example", chainId: 91342, privateKey,
    passportAddress: `0x${"4".repeat(40)}`, stampAddress: `0x${"5".repeat(40)}`, deploymentBlock: 1n,
    collectibleAddress: contract, collectibleDeploymentBlock: 10n, client: client as PublicClient });
}

describe("Viem Collectible binding", () => {
  it("fails closed when an existing token has no canonical prepared submission", async () => {
    const client = { readContract: vi.fn().mockResolvedValue(1n) };
    const payload: CollectiblePayloadV1 = { recipient, celebritySlug: "kara", liveSlug: "kara-live", claimId, metadataVersion: 1 };
    await expect(adapter(client).findExisting("collectible", payload)).rejects.toMatchObject({ code: "COLLECTIBLE_UNEXPECTED_EXISTING_MINT", retryable: false });
  });

  it("rejects existing chain state whose tokenURI differs from signed canonical metadata", async () => {
    const workerSubmission = await submission();
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "tokenByClaimId" ? 1n : functionName === "ownerOf" ? recipient : "ipfs://wrong"),
      getLogs: vi.fn().mockResolvedValue([{ transactionHash: workerSubmission.txHash, args: { claimKey, tokenId: 1n, to: recipient, metadataUri: "ipfs://expected" } }]),
    };
    const payload: CollectiblePayloadV1 = { recipient, celebritySlug: "kara", liveSlug: "kara-live", claimId, metadataVersion: 1, workerSubmission };
    await expect(adapter(client).findExisting("collectible", payload)).rejects.toMatchObject({ code: "COLLECTIBLE_CHAIN_STATE_MISMATCH", retryable: false });
  });

  it("reconciles a canonical existing token from mapping, owner, URI, and event", async () => {
    const workerSubmission = await submission();
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "tokenByClaimId" ? 1n : functionName === "ownerOf" ? recipient : "ipfs://expected"),
      getLogs: vi.fn().mockResolvedValue([{ transactionHash: workerSubmission.txHash, args: { claimKey, tokenId: 1n, to: recipient, metadataUri: "ipfs://expected" } }]),
    };
    const payload: CollectiblePayloadV1 = { recipient, celebritySlug: "kara", liveSlug: "kara-live", claimId, metadataVersion: 1, workerSubmission };

    await expect(adapter(client).findExisting("collectible", payload)).resolves.toEqual({ txHash: workerSubmission.txHash, tokenId: 1n });
  });

  it("accepts only the canonical Collectible receipt event", async () => {
    const workerSubmission = await submission();
    const log = {
      address: contract,
      topics: encodeEventTopics({ abi: eventAbi, eventName: "CollectibleMinted", args: { claimKey, tokenId: 7n, to: recipient } }),
      data: encodeAbiParameters([{ type: "string" }], ["ipfs://expected"]),
    };
    const payload: CollectiblePayloadV1 = { recipient, celebritySlug: "kara", liveSlug: "kara-live", claimId, metadataVersion: 1, workerSubmission };

    await expect(adapter({ getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [log] }) })
      .receipt(workerSubmission.txHash, "collectible", payload, workerSubmission))
      .resolves.toEqual({ txHash: workerSubmission.txHash, tokenId: 7n });

    await expect(adapter({ getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [{ ...log, address: `0x${"9".repeat(40)}` }] }) })
      .receipt(workerSubmission.txHash, "collectible", payload, workerSubmission))
      .rejects.toMatchObject({ code: "MINT_EVENT_NOT_FOUND", retryable: false });
  });

  it("rejects a stored transaction hash that is not derived from its signed bytes", async () => {
    const canonical = await submission();
    const workerSubmission = { ...canonical, txHash: `0x${"a".repeat(64)}` as Hash };
    const client = { getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [] }) };
    const payload: CollectiblePayloadV1 = { recipient, celebritySlug: "kara", liveSlug: "kara-live", claimId, metadataVersion: 1, workerSubmission };

    await expect(adapter(client).receipt(workerSubmission.txHash, "collectible", payload, workerSubmission))
      .rejects.toMatchObject({ code: "COLLECTIBLE_RECEIPT_MISMATCH", retryable: false });
  });

  it("requires the paired Collectible binding before preparing", async () => {
    const without = new ViemChainAdapter({ rpcUrl: "https://rpc.example", chainId: 91342, privateKey, passportAddress: `0x${"4".repeat(40)}`, stampAddress: `0x${"5".repeat(40)}`, deploymentBlock: 1n, client: {} as PublicClient });
    const payload: CollectiblePayloadV1 = { recipient, celebritySlug: "kara", liveSlug: "kara-live", claimId, metadataVersion: 1 };
    await expect(without.prepare("collectible", payload, "ipfs://expected")).rejects.toMatchObject({ code: "COLLECTIBLE_CHAIN_NOT_CONFIGURED" });
  });
});
