import "server-only";

import { keccak256, stringToHex } from "viem";
import type { z } from "zod";
import type { mintFactsSchema } from "../../features/passport/domain/passport-read-model";
import { getPublicOnchainResult } from "./public-snapshot";

export type OwnerMintFacts = z.infer<typeof mintFactsSchema>;
type PublicReader = typeof getPublicOnchainResult;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function originalFacts(mint: OwnerMintFacts): OwnerMintFacts {
  return {
    status: "minted",
    txHash: mint.originalAsset!.txHash,
    tokenId: mint.originalAsset!.tokenId,
  };
}

export async function validateOwnerMintReplacements(
  mints: readonly OwnerMintFacts[],
  readPublicSnapshot: PublicReader = getPublicOnchainResult,
): Promise<OwnerMintFacts[]> {
  const native = mints.filter((mint) => mint.replacement && !same(mint.replacement.sourceHub, ZERO_ADDRESS));
  if (native.length === 0) return [...mints];
  const result = await readPublicSnapshot();
  if (result.state !== "available") return mints.map((mint) => native.includes(mint) ? originalFacts(mint) : mint);

  const credentials = result.snapshot.actions.flatMap((action) => action.credentials);
  return mints.map((mint) => {
    const replacement = mint.replacement;
    const original = mint.originalAsset;
    if (!replacement || !original || same(replacement.sourceHub, ZERO_ADDRESS)) return mint;
    const verified = credentials.some((credential) => {
      const representative = credential.representativeAsset;
      return representative
        && same(credential.nftContract, original.nftContract)
        && credential.tokenId === original.tokenId
        && same(representative.nftContract, mint.nftContract!)
        && representative.tokenId === mint.tokenId
        && same(representative.metadataHash, keccak256(stringToHex(mint.metadataUri!)))
        && same(representative.migration.batchId, replacement.batchId)
        && same(representative.migration.txHash, mint.txHash!)
        && representative.migration.blockNumber === replacement.blockNumber
        && same(representative.migration.sourceHub, replacement.sourceHub)
        && same(representative.migration.sourceActionId, replacement.sourceActionId);
    });
    return verified ? mint : originalFacts(mint);
  });
}
