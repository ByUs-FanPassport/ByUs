import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ViemChainAdapter } from "../src/adapters/viem-chain.js";
import type { JobPayload, PassportPayloadV1, PreparedSubmission, ReactionPayloadV1, StampPayloadV1 } from "../src/domain.js";

const privateKey = `0x${"1".repeat(64)}` as Hex;
const passportAddress = `0x${"2".repeat(40)}` as Address;
const stampAddress = `0x${"3".repeat(40)}` as Address;
const collectibleAddress = `0x${"4".repeat(40)}` as Address;
const recipient = `0x${"5".repeat(40)}` as Address;
const otherRecipient = `0x${"6".repeat(40)}` as Address;
const passportId = `0x${"7".repeat(64)}` as Hash;
const issuanceId = `0x${"8".repeat(64)}` as Hash;

const passportMintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "passportId", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] }] as const;
const stampMintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "issuanceId", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] }] as const;
const passportEventAbi = [{ type: "event", name: "PassportMinted", inputs: [{ indexed: true, name: "passportId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] }] as const;
const stampEventAbi = [{ type: "event", name: "StampMinted", inputs: [{ indexed: true, name: "issuanceId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] }] as const;

const passportPayload: PassportPayloadV1 = { recipient, celebritySlug: "kara", passportId };
const stampPayload: StampPayloadV1 = { recipient, celebritySlug: "kara", issuanceId, stampType: "Attendance" };
const reactionPayload: ReactionPayloadV1 = { recipient, celebritySlug: "kara", issuanceId, reactionType: "FirstReaction" };

function adapter(client: unknown) {
  return new ViemChainAdapter({
    rpcUrl: "https://rpc.example",
    chainId: 91342,
    privateKey,
    passportAddress,
    stampAddress,
    deploymentBlock: 1n,
    collectibleAddress,
    collectibleDeploymentBlock: 10n,
    client: client as PublicClient,
  });
}

async function submission(
  entityType: "passport" | "stamp" | "reaction",
  overrides: { chainId?: number; to?: Address; recipient?: Address; key?: Hash; metadataUri?: string; value?: bigint; nonce?: number; gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {},
): Promise<PreparedSubmission> {
  const isPassport = entityType === "passport";
  const signedTransaction = await privateKeyToAccount(privateKey).signTransaction({
    chainId: overrides.chainId ?? 91342,
    type: "eip1559",
    to: overrides.to ?? (isPassport ? passportAddress : stampAddress),
    nonce: overrides.nonce ?? 4,
    gas: overrides.gas ?? 200000n,
    maxFeePerGas: overrides.maxFeePerGas ?? 1n,
    maxPriorityFeePerGas: overrides.maxPriorityFeePerGas ?? 1n,
    value: overrides.value,
    data: encodeFunctionData({
      abi: isPassport ? passportMintAbi : stampMintAbi,
      functionName: "mint",
      args: [overrides.recipient ?? recipient, overrides.key ?? (isPassport ? passportId : issuanceId), overrides.metadataUri ?? "ipfs://expected"],
    }),
  });
  return { txHash: keccak256(signedTransaction), signedTransaction };
}

function mintLog(entityType: "passport" | "stamp" | "reaction", overrides: { address?: Address; recipient?: Address; key?: Hash; metadataUri?: string; tokenId?: bigint } = {}) {
  const isPassport = entityType === "passport";
  const tokenId = overrides.tokenId ?? 7n;
  return {
    address: overrides.address ?? (isPassport ? passportAddress : stampAddress),
    topics: isPassport
      ? encodeEventTopics({ abi: passportEventAbi, eventName: "PassportMinted", args: { passportId: overrides.key ?? passportId, tokenId, to: overrides.recipient ?? recipient } })
      : encodeEventTopics({ abi: stampEventAbi, eventName: "StampMinted", args: { issuanceId: overrides.key ?? issuanceId, tokenId, to: overrides.recipient ?? recipient } }),
    data: encodeAbiParameters([{ type: "string" }], [overrides.metadataUri ?? "ipfs://expected"]),
  };
}

describe("Viem mint transaction and receipt integrity", () => {
  it.each([
    ["passport", passportPayload],
    ["stamp", stampPayload],
    ["reaction", reactionPayload],
  ] as const)("accepts only the matching %s contract event and business identity", async (entityType, payload) => {
    const prepared = await submission(entityType);
    const validClient = { getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [mintLog(entityType)] }) };
    await expect(adapter(validClient).receipt(prepared.txHash, entityType, payload, prepared)).resolves.toEqual({ txHash: prepared.txHash, tokenId: 7n });

    for (const forged of [
      mintLog(entityType, { address: collectibleAddress }),
      mintLog(entityType, { key: `0x${"9".repeat(64)}` }),
      mintLog(entityType, { recipient: otherRecipient }),
      mintLog(entityType, { metadataUri: "ipfs://wrong" }),
    ]) {
      const client = { getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [forged] }) };
      await expect(adapter(client).receipt(prepared.txHash, entityType, payload, prepared)).rejects.toMatchObject({ code: "MINT_EVENT_NOT_FOUND", retryable: false });
    }
  });

  it.each([
    ["passport", passportPayload],
    ["stamp", stampPayload],
    ["reaction", reactionPayload],
  ] as const)("rejects a stored %s transaction for the wrong chain, target, recipient, key, or value", async (entityType, payload) => {
    const invalidSubmissions = await Promise.all([
      submission(entityType, { chainId: 1 }),
      submission(entityType, { to: entityType === "passport" ? stampAddress : passportAddress }),
      submission(entityType, { recipient: otherRecipient }),
      submission(entityType, { key: `0x${"a".repeat(64)}` }),
      submission(entityType, { value: 1n }),
    ]);
    const client = { getTransactionReceipt: vi.fn() };
    for (const invalid of invalidSubmissions) {
      await expect(adapter(client).receipt(invalid.txHash, entityType, payload, invalid)).rejects.toMatchObject({ code: "PREPARED_TRANSACTION_MISMATCH", retryable: false });
    }
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("reconciles legacy Passport state only when mapping, owner, event, recipient, and URI agree", async () => {
    const transactionHash = `0x${"b".repeat(64)}` as Hash;
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "tokenByPassportId" ? 7n : functionName === "ownerOf" ? recipient : "ipfs://expected"),
      getLogs: vi.fn().mockResolvedValue([{ address: passportAddress, transactionHash, args: { passportId, tokenId: 7n, to: recipient, metadataUri: "ipfs://expected" } }]),
    };
    await expect(adapter(client).findExisting("passport", passportPayload)).resolves.toEqual({ txHash: transactionHash, tokenId: 7n });

    client.getLogs.mockResolvedValueOnce([{ address: passportAddress, transactionHash, args: { passportId, tokenId: 7n, to: otherRecipient, metadataUri: "ipfs://expected" } }]);
    await expect(adapter(client).findExisting("passport", passportPayload)).rejects.toMatchObject({ code: "MINT_CHAIN_STATE_MISMATCH", retryable: false });

    client.getLogs.mockResolvedValueOnce([{ address: collectibleAddress, transactionHash, args: { passportId, tokenId: 7n, to: recipient, metadataUri: "ipfs://expected" } }]);
    await expect(adapter(client).findExisting("passport", passportPayload)).rejects.toMatchObject({ code: "MINT_CHAIN_STATE_MISMATCH", retryable: false });
  });

  it.each([
    ["stamp", stampPayload],
    ["reaction", reactionPayload],
  ] as const)("reconciles legacy %s state through balance, event, recipient, and URI", async (entityType, payload) => {
    const transactionHash = `0x${"c".repeat(64)}` as Hash;
    const client = {
      readContract: vi.fn<(args: { functionName: string }) => Promise<unknown>>(async ({ functionName }) => functionName === "tokenByIssuanceId" ? 7n : functionName === "balanceOf" ? 1n : "ipfs://expected"),
      getLogs: vi.fn().mockResolvedValue([{ address: stampAddress, transactionHash, args: { issuanceId, tokenId: 7n, to: recipient, metadataUri: "ipfs://expected" } }]),
    };
    await expect(adapter(client).findExisting(entityType, payload)).resolves.toEqual({ txHash: transactionHash, tokenId: 7n });

    client.readContract.mockImplementationOnce(async () => 7n).mockImplementationOnce(async () => 0n).mockImplementationOnce(async () => "ipfs://expected");
    await expect(adapter(client).findExisting(entityType, payload)).rejects.toMatchObject({ code: "MINT_CHAIN_STATE_MISMATCH", retryable: false });
  });

  it.each([
    ["passport", passportPayload],
    ["stamp", stampPayload],
    ["reaction", reactionPayload],
  ] as const)("keeps a missing %s mint event retryable while RPC indexing catches up", async (entityType, payload) => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "tokenByPassportId" || functionName === "tokenByIssuanceId"
        ? 7n
        : functionName === "ownerOf"
          ? recipient
          : functionName === "balanceOf"
            ? 1n
            : "ipfs://expected"),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    await expect(adapter(client).findExisting(entityType, payload)).rejects.toMatchObject({ code: "MINT_EVENT_NOT_FOUND", retryable: true });
  });

  it("validates a stored transaction before a normal retry broadcast", async () => {
    const prepared = await submission("passport", { nonce: 11 });
    const client = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error("transaction could not be found")),
      sendRawTransaction: vi.fn().mockResolvedValue(prepared.txHash),
    };
    const chain = adapter(client);
    await expect(chain.receipt(prepared.txHash, "passport", passportPayload, prepared)).resolves.toBeNull();
    await expect(chain.broadcast(prepared.signedTransaction)).resolves.toBe(prepared.txHash);
    expect(client.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("does not broadcast signed bytes that were not validated against a job", async () => {
    const prepared = await submission("passport");
    const client = { sendRawTransaction: vi.fn() };
    await expect(adapter(client).broadcast(prepared.signedTransaction)).rejects.toMatchObject({ code: "PREPARED_TRANSACTION_NOT_VALIDATED", retryable: false });
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects malformed stored signed bytes before any receipt lookup or broadcast", async () => {
    const signedTransaction = "0x12" as Hex;
    const prepared = { txHash: keccak256(signedTransaction), signedTransaction };
    const client = { getTransactionReceipt: vi.fn(), sendRawTransaction: vi.fn() };
    const chain = adapter(client);
    await expect(chain.receipt(prepared.txHash, "passport", passportPayload, prepared)).rejects.toMatchObject({ code: "PREPARED_TRANSACTION_MISMATCH", retryable: false });
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("blocks an over-limit estimate before signing", async () => {
    const client = {
      getTransactionCount: vi.fn().mockResolvedValue(1),
      estimateGas: vi.fn().mockResolvedValue(1_000_001n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    };
    await expect(adapter(client).prepare("passport", passportPayload, "ipfs://expected")).rejects.toMatchObject({
      code: "MINT_FEE_POLICY_BLOCKED",
      message: "Mint transaction is temporarily blocked by fee policy",
      retryable: true,
    });
  });

  it("reconciles a completed high-fee transaction but blocks its retry broadcast", async () => {
    const prepared = await submission("passport", { gas: 1_000_001n, maxFeePerGas: 100_000_001n, maxPriorityFeePerGas: 100_000_000n });
    const completed = adapter({ getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [mintLog("passport")] }) });
    await expect(completed.receipt(prepared.txHash, "passport", passportPayload, prepared)).resolves.toEqual({ txHash: prepared.txHash, tokenId: 7n });

    const client = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error("transaction could not be found")),
      sendRawTransaction: vi.fn(),
    };
    const retry = adapter(client);
    await expect(retry.receipt(prepared.txHash, "passport", passportPayload, prepared)).resolves.toBeNull();
    await expect(retry.broadcast(prepared.signedTransaction)).rejects.toMatchObject({ code: "MINT_FEE_POLICY_BLOCKED", retryable: true });
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });
});
