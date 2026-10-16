import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { snapshotClient, type FinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { onchainConfig } from "./public-config";
import type { PublicRepresentativeAsset } from "./public-types";

const migratorAbi = parseAbi([
  "event CredentialReplaced(bytes32 indexed batchId,address indexed oldContract,uint256 indexed oldTokenId,address newContract,uint256 newTokenId,address recipient,bytes32 issuanceKey,bytes32 metadataHash,address sourceHub,bytes32 sourceActionId,bytes32 leaf,bool minted)",
  "function timelock() view returns (address)",
  "function operator() view returns (address)",
  "function hub() view returns (address)",
  "function legacyHub() view returns (address)",
  "function environmentId() view returns (bytes32)",
  "function oldPassport() view returns (address)",
  "function oldStamp() view returns (address)",
  "function newPassport() view returns (address)",
  "function newStamp() view returns (address)",
  "function replacements(bytes32) view returns (bytes32 leaf,bytes32 batchId,uint256 tokenId,address recipient,bytes32 metadataHash,address sourceHub,bytes32 sourceActionId,bool minted)",
  "function sourceByTarget(bytes32) view returns (bytes32)",
]);
const passportAbi = parseAbi([
  "function tokenByPassportId(bytes32) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
]);
const stampAbi = parseAbi([
  "function tokenByIssuanceId(bytes32) view returns (uint256)",
  "function balanceOf(address,uint256) view returns (uint256)",
  "function totalSupply(uint256) view returns (uint256)",
  "function uri(uint256) view returns (string)",
]);

export type CredentialReplacementConfig = typeof onchainConfig & {
  credentialReplacement: typeof onchainConfig.credentialReplacement & {
    deployment: { address: Address; fromBlock: bigint };
  };
};

export function credentialAssetKey(nftContract: string, tokenId: string | bigint): string {
  return `${getAddress(nftContract as Address).toLowerCase()}:${tokenId.toString()}`;
}

function assetIdentity(nftContract: Address, tokenId: bigint): Hash {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [getAddress(nftContract), tokenId],
  ));
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function verifyAsset(
  client: PublicClient,
  address: Address,
  kind: number,
  tokenId: bigint,
  issuanceKey: Hash,
  recipient: Address,
  blockNumber: bigint,
  metadataHash?: Hash,
): Promise<boolean> {
  if (kind === 0) {
    const [mappedToken, owner, uri] = await Promise.all([
      client.readContract({ address, abi: passportAbi, functionName: "tokenByPassportId", args: [issuanceKey], blockNumber }),
      client.readContract({ address, abi: passportAbi, functionName: "ownerOf", args: [tokenId], blockNumber }),
      metadataHash ? client.readContract({ address, abi: passportAbi, functionName: "tokenURI", args: [tokenId], blockNumber }) : undefined,
    ]);
    return mappedToken === tokenId && getAddress(owner) === getAddress(recipient)
      && (!metadataHash || keccak256(stringToHex(uri!)) === metadataHash);
  }
  const [mappedToken, balance, supply, uri] = await Promise.all([
    client.readContract({ address, abi: stampAbi, functionName: "tokenByIssuanceId", args: [issuanceKey], blockNumber }),
    client.readContract({ address, abi: stampAbi, functionName: "balanceOf", args: [recipient, tokenId], blockNumber }),
    client.readContract({ address, abi: stampAbi, functionName: "totalSupply", args: [tokenId], blockNumber }),
    metadataHash ? client.readContract({ address, abi: stampAbi, functionName: "uri", args: [tokenId], blockNumber }) : undefined,
  ]);
  return mappedToken === tokenId && balance === 1n && supply === 1n
    && (!metadataHash || keccak256(stringToHex(uri!)) === metadataHash);
}

export async function readFinalizedCredentialReplacements(
  config: CredentialReplacementConfig,
  source: FinalizedActionSnapshot,
  client?: PublicClient,
): Promise<ReadonlyMap<string, PublicRepresentativeAsset>> {
  const deployment = config.credentialReplacement.deployment;
  if (deployment.fromBlock > source.blockNumber) return new Map();
  // Leave time for this reader after the action snapshot's four-minute budget.
  const reader = client ?? snapshotClient(config, AbortSignal.timeout(50_000));
  const blockNumber = source.blockNumber;
  const [chainId, finalizedBlock, timelock, operator, hub, legacyHub, environmentId, oldPassport, oldStamp, newPassport, newStamp] = await Promise.all([
    reader.getChainId(),
    reader.getBlock({ blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "timelock", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "operator", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "hub", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "legacyHub", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "environmentId", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "oldPassport", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "oldStamp", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "newPassport", blockNumber }),
    reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "newStamp", blockNumber }),
  ]);
  if (chainId !== config.chainId || !finalizedBlock.hash || !sameHex(finalizedBlock.hash, source.blockHash)
    || getAddress(timelock) !== getAddress(config.credentialReplacement.timelock)
    || getAddress(operator) !== getAddress(config.credentialReplacement.operator)
    || getAddress(hub) !== getAddress(config.hubAddress)
    || getAddress(legacyHub) !== getAddress(config.deployments[0].hubAddress)
    || !sameHex(environmentId, config.environmentId)
    || getAddress(oldPassport) !== getAddress(config.assetBindings[1][0])
    || getAddress(oldStamp) !== getAddress(config.assetBindings[1][1])
    || getAddress(newPassport) !== getAddress(config.assetBindings[2][0])
    || getAddress(newStamp) !== getAddress(config.assetBindings[2][1])) {
    throw new Error("Credential migrator immutable binding mismatch");
  }

  const relevantSources = new Set(source.actions.flatMap((action) => action.credentials.map((credential) => credentialAssetKey(credential.nftContract, credential.tokenId))));
  const logs = [];
  // The production RPC limits each log query to 1,000 blocks.
  for (let fromBlock = deployment.fromBlock; fromBlock <= blockNumber; fromBlock += 1_000n) {
    const toBlock = fromBlock + 999n < blockNumber ? fromBlock + 999n : blockNumber;
    logs.push(...await reader.getLogs({ address: deployment.address, event: migratorAbi[0], fromBlock, toBlock }));
  }
  const representatives = new Map<string, PublicRepresentativeAsset>();
  const targets = new Set<string>();
  for (let index = 0; index < logs.length; index += 16) {
    const verified = await Promise.all(logs.slice(index, index + 16).map(async (log) => {
      if (log.blockNumber == null || log.blockNumber > blockNumber || !log.blockHash || !log.transactionHash) return;
      const args = log.args;
      if (args.oldContract == null || args.oldTokenId == null || args.newContract == null || args.newTokenId == null
        || args.recipient == null || args.issuanceKey == null || args.metadataHash == null || args.sourceHub == null
        || args.sourceActionId == null || args.leaf == null || args.batchId == null || args.minted == null) return;
      const sourceKey = credentialAssetKey(args.oldContract, args.oldTokenId);
      if (!relevantSources.has(sourceKey)) return;
      const kind = getAddress(args.oldContract) === getAddress(config.assetBindings[1][0]) ? 0
        : getAddress(args.oldContract) === getAddress(config.assetBindings[1][1]) ? 1 : -1;
      const expectedTarget = kind < 0 ? undefined : config.assetBindings[2][kind as 0 | 1];
      const targetKey = credentialAssetKey(args.newContract, args.newTokenId);
      const sourceId = assetIdentity(args.oldContract, args.oldTokenId);
      const targetId = assetIdentity(args.newContract, args.newTokenId);
      const [canonicalBlock, replacement, mappedSource, sourceValid, targetValid] = await Promise.all([
        reader.getBlock({ blockNumber: log.blockNumber }),
        reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "replacements", args: [sourceId], blockNumber }),
        reader.readContract({ address: deployment.address, abi: migratorAbi, functionName: "sourceByTarget", args: [targetId], blockNumber }),
        kind < 0 ? false : verifyAsset(reader, args.oldContract, kind, args.oldTokenId, args.issuanceKey, args.recipient, blockNumber),
        kind < 0 ? false : verifyAsset(reader, args.newContract, kind, args.newTokenId, args.issuanceKey, args.recipient, blockNumber, args.metadataHash),
      ]);
      const [mappedLeaf, mappedBatch, mappedTokenId, mappedRecipient, mappedMetadataHash, mappedSourceHub, mappedSourceActionId, mappedMinted] = replacement;
      if (!canonicalBlock.hash || !sameHex(canonicalBlock.hash, log.blockHash) || !expectedTarget
        || getAddress(args.newContract) !== getAddress(expectedTarget) || !sameHex(mappedLeaf, args.leaf)
        || !sameHex(mappedBatch, args.batchId) || mappedTokenId !== args.newTokenId
        || getAddress(mappedRecipient) !== getAddress(args.recipient) || !sameHex(mappedMetadataHash, args.metadataHash)
        || getAddress(mappedSourceHub) !== getAddress(args.sourceHub) || !sameHex(mappedSourceActionId, args.sourceActionId)
        || mappedMinted !== args.minted || !sameHex(mappedSource, sourceId) || !sourceValid || !targetValid) return;
      return { sourceKey, targetKey, asset: {
        nftContract: getAddress(args.newContract), tokenId: args.newTokenId.toString(), owner: getAddress(args.recipient),
        issuanceKey: args.issuanceKey, metadataHash: args.metadataHash,
        migration: {
          migratorAddress: getAddress(deployment.address), batchId: args.batchId, txHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(), sourceHub: getAddress(args.sourceHub), sourceActionId: args.sourceActionId,
          minted: args.minted,
        },
      } satisfies PublicRepresentativeAsset };
    }));
    // Apply verified results in event order, independent of RPC completion order.
    for (const result of verified) {
      if (!result || representatives.has(result.sourceKey) || targets.has(result.targetKey)) continue;
      representatives.set(result.sourceKey, result.asset);
      targets.add(result.targetKey);
    }
  }
  return representatives;
}
