import { createPublicClient, decodeAbiParameters, decodeEventLog, defineChain, encodeAbiParameters, getAddress, http, keccak256, type Address, type Hash, type PublicClient } from "viem";
import { actionHubAbi, easAbi } from "./adapters/viem-action-hub.js";
import type { IndexedFanAction } from "./action-metrics.js";

type Recorded = { actionId: Hash; fan: Address; occurrenceId: Hash; revision: number; actionCode: number; origin: number; transactionHash: Hash; blockNumber: bigint; blockHash: Hash };
type ActionRecord = { actionId: Hash; occurrenceId: Hash; easUID: Hash; schemaUID: Hash; fan: Address; revision: number; actionCode: number; status: number; recordHash: Hash; origin: number; migrationBatchId: Hash };
type CredentialRef = { nftContract: Address; tokenId: bigint; kind: number; issuanceKey: Hash; linkOrigin: number };

export class ViemActionLogReader {
  private readonly client: PublicClient;
  constructor(private readonly options: { rpcUrl: string; chainId: number; hubAddress: Address; fromBlock: bigint; client?: PublicClient }) {
    const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
    this.client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl) });
  }

  async read(environmentId: Hash): Promise<IndexedFanAction[]> {
    const [actualChainId, actualEnvironment] = await Promise.all([
      this.client.getChainId(),
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "environmentId" }),
    ]);
    if (actualChainId !== this.options.chainId || actualEnvironment.toLowerCase() !== environmentId.toLowerCase()) {
      throw new Error("Action read-model chain/environment binding mismatch");
    }
    const [logs, easAddress, safe, finalized] = await Promise.all([
      this.client.getLogs({ address: this.options.hubAddress, fromBlock: this.options.fromBlock, toBlock: "latest" }),
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "eas" }),
      this.client.getBlock({ blockTag: "safe" }).catch(() => null),
      this.client.getBlock({ blockTag: "finalized" }).catch(() => null),
    ]);
    const recorded: Recorded[] = [];
    const refsByAction = new Map<string, CredentialRef[]>();
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: actionHubAbi, data: log.data, topics: log.topics });
        const args = decoded.args as Record<string, unknown>;
        if (decoded.eventName === "CredentialLinked") {
          const key = String(args.actionId).toLowerCase();
          const existing = refsByAction.get(key) ?? [];
          existing.push({ nftContract: args.nftContract as Address, tokenId: args.tokenId as bigint, kind: Number(args.credentialKind), issuanceKey: args.issuanceKey as Hash, linkOrigin: Number(args.linkOrigin) });
          refsByAction.set(key, existing);
          continue;
        }
        if (decoded.eventName !== "FanActionRecorded" || !log.transactionHash || !log.blockHash || log.blockNumber == null) continue;
        recorded.push({ actionId: args.actionId as Hash, fan: args.fan as Address, occurrenceId: args.occurrenceId as Hash, revision: Number(args.revision), actionCode: 0, origin: Number(args.origin), transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash });
      } catch { /* unrelated Hub log */ }
    }
    const result: IndexedFanAction[] = [];
    for (const event of recorded) {
      const [record, latestActionId] = await Promise.all([
        this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "getAction", args: [event.actionId] }) as Promise<ActionRecord>,
        this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "latestActionId", args: [event.occurrenceId] }),
      ]);
      const canonicalBlock = await this.client.getBlock({ blockNumber: event.blockNumber });
      if (canonicalBlock.hash?.toLowerCase() !== event.blockHash.toLowerCase()) throw new Error("Action read-model reorg during read");
      const refs = refsByAction.get(event.actionId.toLowerCase()) ?? [];
      const [attestation, easValid] = await Promise.all([
        this.client.readContract({ address: easAddress, abi: easAbi, functionName: "getAttestation", args: [record.easUID] }),
        this.client.readContract({ address: easAddress, abi: easAbi, functionName: "isAttestationValid", args: [record.easUID] }).catch(() => false),
      ]);
      const data = decodeAbiParameters([
        { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint16" },
        { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" },
        { type: "bytes32" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" },
        { type: "bytes32" }, { type: "bytes32" },
      ], attestation.data);
      const zero = `0x${"0".repeat(64)}`;
      if (attestation.uid.toLowerCase() !== record.easUID.toLowerCase()
        || getAddress(attestation.recipient) !== getAddress(record.fan)
        || getAddress(attestation.attester) !== getAddress(this.options.hubAddress)
        || attestation.refUID.toLowerCase() !== zero
        || keccak256(attestation.data).toLowerCase() !== record.recordHash.toLowerCase()
        || data[0].toLowerCase() !== record.occurrenceId.toLowerCase()
        || data[1].toLowerCase() !== record.actionId.toLowerCase()
        || data[2] !== record.revision || data[3] !== record.actionCode
        || data[6].toLowerCase() !== actualEnvironment.toLowerCase()
        || data[10] !== event.origin || record.origin !== event.origin
        || data[13].toLowerCase() !== record.migrationBatchId.toLowerCase()
        || attestation.schema.toLowerCase() !== record.schemaUID.toLowerCase()) {
        throw new Error("Action read-model EAS record mismatch");
      }
      const sortedRefs = [...refs].sort((a, b) => BigInt(a.nftContract) < BigInt(b.nftContract) ? -1 : BigInt(a.nftContract) > BigInt(b.nftContract) ? 1 : a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0);
      const refsHash = keccak256(encodeAbiParameters([{ type: "tuple[]", components: [
        { name: "nftContract", type: "address" }, { name: "tokenId", type: "uint256" },
        { name: "kind", type: "uint8" }, { name: "issuanceKey", type: "bytes32" }, { name: "linkOrigin", type: "uint8" },
      ] }], [sortedRefs]));
      if (refsHash.toLowerCase() !== data[12].toLowerCase()) throw new Error("Action read-model credential logs mismatch");
      const isLatest = latestActionId.toLowerCase() === record.actionId.toLowerCase();
      const finality: IndexedFanAction["finality"] = finalized && event.blockNumber <= finalized.number ? "finalized" : safe && event.blockNumber <= safe.number ? "safe" : "included";
      result.push({
        chainId: this.options.chainId, occurrenceId: record.occurrenceId, actionId: record.actionId, revision: record.revision,
        actionCode: record.actionCode || event.actionCode, recipient: record.fan, environmentId: actualEnvironment, hubProxy: this.options.hubAddress,
        schemaUid: record.schemaUID, easAttester: attestation.attester, easRecipient: attestation.recipient,
        easRevocationTime: attestation.revocationTime, easExpirationTime: attestation.expirationTime,
        easIsAttestationValid: easValid && isLatest, status: record.status === 2 ? "ACTIVE" : "INVALIDATED",
        origin: event.origin === 1 ? "HISTORICAL" : "NATIVE", finality, txHash: event.transactionHash,
        credentials: refs.map((ref) => ({
          credentialKey: keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [BigInt(this.options.chainId), getAddress(ref.nftContract), ref.tokenId])),
          kind: ref.kind, linkOrigin: ref.linkOrigin, nftContract: ref.nftContract, tokenId: ref.tokenId.toString(),
        })),
      });
    }
    return result;
  }
}
