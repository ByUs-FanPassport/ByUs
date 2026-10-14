import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hash, type PublicClient } from "viem";
import type { FinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { onchainConfig } from "./public-config";
import {
  credentialAssetKey,
  readFinalizedCredentialReplacements,
  type CredentialReplacementConfig,
} from "./credential-replacements";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const migrator = address(9);
const recipient = address(10);
const oldTokenId = 23n;
const newTokenId = 44n;
const issuanceKey = hash(11);
const batchId = hash(12);
const leaf = hash(13);
const txHash = hash(14);
const headHash = hash(15);
const eventHash = hash(16);
const metadataUri = "ipfs://verified/stamp.json";
const metadataHash = keccak256(stringToHex(metadataUri));
const sourceId = (kind: 0 | 1) => keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }],
  [onchainConfig.assetBindings[1][kind], oldTokenId],
));

const config = {
  ...onchainConfig,
  credentialReplacement: {
    ...onchainConfig.credentialReplacement,
    deployment: { address: migrator, fromBlock: 80n },
  },
} as CredentialReplacementConfig;

it("keeps the original ledger available before the migrator deployment is finalized", async () => {
  const client = fakeClient();
  expect(await readFinalizedCredentialReplacements(config, { ...source(), blockNumber: 79n }, client)).toEqual(new Map());
  expect(client.getLogs).not.toHaveBeenCalled();
  expect(client.readContract).not.toHaveBeenCalled();
});

function source(kind: 0 | 1 = 1): FinalizedActionSnapshot {
  return {
    blockNumber: 100n,
    blockHash: headHash,
    timestamp: 1_800_000_000n,
    deployments: config.deployments.map((deployment) => ({ ...deployment, label: deployment.label, actionCount: 1 })),
    sourceCollisions: [],
    lifecycleTransactions: [],
    actions: [{
      chainId: config.chainId, sourceOccurrence: hash(20), occurrenceId: hash(21), actionId: hash(22), revision: 1,
      actionCode: 10, recipient, originalRecipient: recipient, environmentId: config.environmentId,
      hubProxy: config.hubAddress, schemaUid: config.schemaUid, easUid: hash(23), easAttester: config.hubAddress,
      easRecipient: recipient, easRevocationTime: 0n, easExpirationTime: 0n, easIsAttestationValid: true,
      status: "ACTIVE", origin: "NATIVE", finality: "finalized", txHash: hash(24), creatorId: hash(25),
      campaignId: hash(0), occurredDay: 20_000, blockNumber: 90n, blockHash: hash(26),
      credentials: [{ credentialKey: hash(27), kind, linkOrigin: 0, nftContract: config.assetBindings[1][kind], tokenId: oldTokenId.toString() }],
    }],
  };
}

function fakeClient(fault?: "event" | "mapping" | "owner" | "uri" | "unfinalized" | "immutable", kind: 0 | 1 = 1): PublicClient {
  const eventBlock = fault === "unfinalized" ? 101n : 90n;
  const eventBlockHash = fault === "event" ? hash(99) : eventHash;
  const getLogs = vi.fn(async () => [{
    args: {
      batchId, oldContract: config.assetBindings[1][kind], oldTokenId,
      newContract: config.assetBindings[2][kind], newTokenId, recipient, issuanceKey, metadataHash,
      sourceHub: config.hubAddress, sourceActionId: hash(22), leaf, minted: true,
    },
    blockNumber: eventBlock,
    blockHash: eventBlockHash,
    transactionHash: txHash,
  }]);
  const readContract = vi.fn(async (request: { address: Address; functionName: string }) => {
    switch (request.functionName) {
      case "timelock": return config.credentialReplacement.timelock;
      case "operator": return fault === "immutable" ? address(98) : config.credentialReplacement.operator;
      case "hub": return config.hubAddress;
      case "legacyHub": return config.deployments[0].hubAddress;
      case "environmentId": return config.environmentId;
      case "oldPassport": return config.assetBindings[1][0];
      case "oldStamp": return config.assetBindings[1][1];
      case "newPassport": return config.assetBindings[2][0];
      case "newStamp": return config.assetBindings[2][1];
      case "replacements": return [
        leaf, batchId, newTokenId, recipient, fault === "mapping" ? hash(98) : metadataHash,
        config.hubAddress, hash(22), true,
      ];
      case "sourceByTarget": return sourceId(kind);
      case "tokenByPassportId":
      case "tokenByIssuanceId": return request.address.toLowerCase() === config.assetBindings[1][kind] ? oldTokenId : newTokenId;
      case "ownerOf": return fault === "owner" && request.address.toLowerCase() === config.assetBindings[2][kind] ? address(97) : recipient;
      case "balanceOf": return fault === "owner" && request.address.toLowerCase() === config.assetBindings[2][kind] ? 0n : 1n;
      case "totalSupply": return 1n;
      case "tokenURI":
      case "uri": return fault === "uri" ? "ipfs://wrong/stamp.json" : metadataUri;
      default: throw new Error(`Unexpected read ${request.functionName}`);
    }
  });
  return {
    getChainId: vi.fn(async () => config.chainId),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 100n ? headHash : eventHash })),
    getLogs,
    readContract,
  } as unknown as PublicClient;
}

describe("finalized credential replacements", () => {
  it("returns a representative only after event, mapping, ownership, key, and URI verification", async () => {
    const result = await readFinalizedCredentialReplacements(config, source(), fakeClient());
    expect(result.get(credentialAssetKey(config.assetBindings[1][1], oldTokenId))).toMatchObject({
      nftContract: expect.stringMatching(new RegExp(`^${config.assetBindings[2][1]}$`, "i")), tokenId: newTokenId.toString(),
      owner: expect.stringMatching(new RegExp(`^${recipient}$`, "i")),
      issuanceKey, metadataHash,
      migration: { migratorAddress: migrator, batchId, txHash, blockNumber: "90", sourceActionId: hash(22) },
    });
  });

  it("verifies Passport mapping, owner, and token URI with the same boundary", async () => {
    const result = await readFinalizedCredentialReplacements(config, source(0), fakeClient(undefined, 0));
    expect(result.get(credentialAssetKey(config.assetBindings[1][0], oldTokenId))).toMatchObject({
      nftContract: expect.stringMatching(new RegExp(`^${config.assetBindings[2][0]}$`, "i")), tokenId: newTokenId.toString(),
    });
  });

  it.each(["event", "mapping", "owner", "uri"] as const)("rejects a %s mismatch", async (fault) => {
    const result = await readFinalizedCredentialReplacements(config, source(), fakeClient(fault));
    expect(result.size).toBe(0);
  });

  it("excludes events beyond the action snapshot finalized head", async () => {
    const client = fakeClient("unfinalized");
    const result = await readFinalizedCredentialReplacements(config, source(), client);
    expect(result.size).toBe(0);
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 80n, toBlock: 100n }));
  });

  it("fails closed when migrator immutables do not match the configured governance boundary", async () => {
    await expect(readFinalizedCredentialReplacements(config, source(), fakeClient("immutable")))
      .rejects.toThrow("Credential migrator immutable binding mismatch");
  });
});
