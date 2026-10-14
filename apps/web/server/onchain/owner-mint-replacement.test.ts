import { expect, it, vi } from "vitest";
import { keccak256, stringToHex } from "viem";
vi.mock("server-only", () => ({}));
import { validateOwnerMintReplacements, type OwnerMintFacts } from "./owner-mint-replacement";
import type { PublicOnchainResult } from "./public-types";

const hash = (value: string) => `0x${value.repeat(64)}`;
const address = (value: string) => `0x${value.repeat(40)}`;
const oldContract = address("1");
const newContract = address("2");
const sourceHub = address("3");
const oldTx = hash("4");
const migrationTx = hash("5");
const batchId = hash("6");
const sourceActionId = hash("7");
const metadataUri = "ipfs://verified/replacement.json";
const replacement: OwnerMintFacts = {
  status: "minted", txHash: migrationTx, tokenId: "22", nftContract: newContract, metadataUri,
  originalAsset: { nftContract: oldContract, tokenId: "11", metadataUri: "ipfs://original.json", txHash: oldTx },
  replacement: { batchId, sourceActionId, sourceHub, blockNumber: "99", blockHash: hash("8") },
};
const original = { status: "minted", txHash: oldTx, tokenId: "11" };

function publicResult(withRepresentative = true): PublicOnchainResult {
  return { state: "available", snapshot: {
    actions: [{ credentials: [{
      kind: 1, nftContract: oldContract, tokenId: "11", linkOrigin: 0,
      ...(withRepresentative ? { representativeAsset: {
        nftContract: newContract, tokenId: "22", owner: address("9"), issuanceKey: hash("a"),
        metadataHash: keccak256(stringToHex(metadataUri)),
        migration: { migratorAddress: address("b"), batchId, txHash: migrationTx, blockNumber: "99", sourceHub, sourceActionId, minted: true },
      } } : {}),
    }] }],
  } } as PublicOnchainResult;
}

it("keeps a native replacement only when the cached public snapshot verifies every identity", async () => {
  await expect(validateOwnerMintReplacements([replacement], vi.fn(async () => publicResult())))
    .resolves.toEqual([replacement]);
});

it.each([
  ["target asset", { ...replacement, tokenId: "23" }],
  ["migration evidence", { ...replacement, replacement: { ...replacement.replacement!, sourceActionId: hash("c") } }],
])("restores original facts when the %s does not match public evidence", async (_label, candidate) => {
  await expect(validateOwnerMintReplacements([candidate], vi.fn(async () => publicResult())))
    .resolves.toEqual([original]);
});

it.each([
  ["unavailable", { state: "unavailable" } as PublicOnchainResult],
  ["invalidated source", publicResult(false)],
])("restores original mint facts when the public snapshot is %s", async (_label, result) => {
  await expect(validateOwnerMintReplacements([replacement], vi.fn(async () => result)))
    .resolves.toEqual([original]);
});

it("reads the public snapshot once for a replacement collection", async () => {
  const read = vi.fn(async () => publicResult());
  await validateOwnerMintReplacements([replacement, { ...replacement }], read);
  expect(read).toHaveBeenCalledTimes(1);
});

it("does not read the public snapshot without a native replacement", async () => {
  const read = vi.fn(async () => publicResult());
  const plain: OwnerMintFacts = { status: "minted", txHash: oldTx, tokenId: "11" };
  const legacy = { ...replacement, replacement: { ...replacement.replacement!, sourceHub: address("0") } };
  await expect(validateOwnerMintReplacements([plain, legacy], read)).resolves.toEqual([plain, legacy]);
  expect(read).not.toHaveBeenCalled();
});
