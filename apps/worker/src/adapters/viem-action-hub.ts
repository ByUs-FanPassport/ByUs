import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { credentialKinds, linkOrigins, localActionId, localOccurrenceId, origins, type CanonicalActionPayloadV1 } from "../action-domain.js";
import type { ActionChainPort, ActionCredentialReceipt, ActionHashResult, ActionReceipt } from "../action-ports.js";
import { WorkerError, type PreparedSubmission } from "../domain.js";
import { assertMintFeePolicy, DEFAULT_MINT_FEE_POLICY, validateMintFeePolicy, type MintFeePolicy } from "../fee-policy.js";
import { actionHubAbi, credentialRefComponents, easAbi } from "../action-abi.js";
export { actionHubAbi, easAbi } from "../action-abi.js";


const passportEventAbi = [{ type: "event", name: "PassportMinted", inputs: [{ indexed: true, name: "passportId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] }] as const;
const stampEventAbi = [{ type: "event", name: "StampMinted", inputs: [{ indexed: true, name: "issuanceId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] }] as const;
const collectibleEventAbi = [{ type: "event", name: "CollectibleMinted", inputs: [{ indexed: true, name: "claimKey", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] }] as const;

export interface ViemActionHubOptions {
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  hubAddress: Address;
  deploymentBlock: bigint;
  feePolicy?: MintFeePolicy;
  client?: PublicClient;
}

type ActionRecord = { occurrenceId: Hash; actionId: Hash; easUID: Hash; requestHash: Hash; recordHash: Hash; schemaUID: Hash; refUID: Hash; fan: Address; revision: number; actionCode: number; schemaVersion: number; policyVersion: number; status: number; origin: number; migrationBatchId: Hash };
type CredentialRef = { nftContract: Address; tokenId: bigint; kind: number; issuanceKey: Hash; linkOrigin: number };

export class ViemActionHubAdapter implements ActionChainPort {
  private readonly account;
  private readonly client: PublicClient;
  private readonly feePolicy: MintFeePolicy;
  private readonly approvedTransactions = new Set<string>();
  readonly relayerAddress: string;

  constructor(private readonly options: ViemActionHubOptions) {
    const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
    this.account = privateKeyToAccount(options.privateKey);
    this.relayerAddress = this.account.address;
    this.client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl) });
    this.feePolicy = options.feePolicy ?? DEFAULT_MINT_FEE_POLICY;
    validateMintFeePolicy(this.feePolicy);
  }

  async canonicalHashes(payload: Omit<CanonicalActionPayloadV1, "occurrenceId" | "actionId" | "requestHash" | "workerSubmission">): Promise<ActionHashResult> {
    await this.assertBinding(payload);
    const request = this.requestTuple(payload);
    const intents = this.intentTuples(payload);
    const occurrenceId = await this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "computeOccurrenceId", args: [payload.request.sourceOccurrence as Hash] });
    const [actionId, requestHash] = await Promise.all([
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "computeActionId", args: [occurrenceId, payload.request.revision] }),
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "hashRequest", args: [payload.operation, request, intents] }),
    ]);
    return { occurrenceId, actionId, requestHash };
  }

  async findExisting(payload: CanonicalActionPayloadV1): Promise<ActionReceipt | null> {
    const record = await this.getAction(payload.actionId as Hash);
    if (record.status === 0) return null;
    this.assertRecord(record, payload);
    const logs = await this.client.getLogs({
      address: this.options.hubAddress,
      event: actionHubAbi[12],
      args: { actionId: payload.actionId as Hash },
      fromBlock: this.options.deploymentBlock,
      toBlock: "latest",
    });
    const log = logs.at(-1);
    if (!log?.transactionHash) throw new WorkerError("ACTION_EVENT_NOT_FOUND", `Recorded action ${payload.actionId} has no canonical event`, true);
    return this.validateReceipt(log.transactionHash, payload);
  }

  async prepare(payload: CanonicalActionPayloadV1): Promise<PreparedSubmission> {
    try {
      await this.assertBinding(payload);
      const data = this.calldata(payload);
      const [nonce, gas, fees] = await Promise.all([
        this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" }),
        this.client.estimateGas({ account: this.account, to: this.options.hubAddress, data }),
        this.client.estimateFeesPerGas(),
      ]);
      assertMintFeePolicy({ type: "eip1559", gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }, this.feePolicy);
      const signedTransaction = await this.account.signTransaction({ chainId: this.options.chainId, type: "eip1559", to: this.options.hubAddress, data, nonce, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const txHash = keccak256(signedTransaction);
      this.approvedTransactions.add(txHash.toLowerCase());
      return { txHash, signedTransaction };
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError("GIWA_ACTION_PREPARE_FAILED", error instanceof Error ? error.message : String(error), true, { cause: error });
    }
  }

  async broadcast(signedTransaction: string): Promise<string> {
    try {
      const transaction = parseTransaction(signedTransaction as Hex);
      assertMintFeePolicy({ type: transaction.type, gas: transaction.gas, maxFeePerGas: transaction.maxFeePerGas, maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }, this.feePolicy);
      const txHash = keccak256(signedTransaction as Hex);
      if (!this.approvedTransactions.has(txHash.toLowerCase())) throw new WorkerError("PREPARED_TRANSACTION_NOT_VALIDATED", "Stored action transaction was not validated before broadcast", false);
      const hash = await this.client.sendRawTransaction({ serializedTransaction: signedTransaction as Hex });
      this.approvedTransactions.delete(txHash.toLowerCase());
      return hash;
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already known")) return keccak256(signedTransaction as Hex);
      throw new WorkerError("GIWA_ACTION_BROADCAST_FAILED", message, true, { cause: error });
    }
  }

  async receipt(payload: CanonicalActionPayloadV1, submission: PreparedSubmission): Promise<ActionReceipt | null> {
    if (submission.txHash.toLowerCase() !== keccak256(submission.signedTransaction as Hex).toLowerCase()) throw new WorkerError("TRANSACTION_HASH_MISMATCH", "Stored action transaction hash differs from signed bytes", false);
    await this.validateEnvelope(payload, submission.signedTransaction as Hex);
    try {
      return await this.validateReceipt(submission.txHash as Hash, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof WorkerError) && (message.includes("could not be found") || message.includes("not found"))) {
        this.approvedTransactions.add(submission.txHash.toLowerCase());
        return null;
      }
      throw error;
    }
  }

  private async validateReceipt(txHash: Hash, payload: CanonicalActionPayloadV1): Promise<ActionReceipt> {
    const receipt = await this.client.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new WorkerError("GIWA_ACTION_TRANSACTION_REVERTED", `Action transaction reverted: ${txHash}`, false);
    let recorded: { args: Record<string, unknown>; logIndex: number } | null = null;
    const linked: ActionCredentialReceipt[] = [];
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== getAddress(this.options.hubAddress)) continue;
      try {
        const decoded = decodeEventLog({ abi: actionHubAbi, data: log.data, topics: log.topics });
        const args = decoded.args as Record<string, unknown>;
        if (decoded.eventName === "FanActionRecorded" && String(args.actionId).toLowerCase() === payload.actionId.toLowerCase()) recorded = { args, logIndex: log.logIndex };
        if (decoded.eventName === "CredentialLinked" && String(args.actionId).toLowerCase() === payload.actionId.toLowerCase()) {
          linked.push({ kind: Number(args.credentialKind), nftContract: String(args.nftContract), tokenId: args.tokenId as bigint, issuanceKey: String(args.issuanceKey), metadataUri: "", linkOrigin: Number(args.linkOrigin), logIndex: log.logIndex });
        }
      } catch { /* unrelated hub log */ }
    }
    if (!recorded) throw new WorkerError("ACTION_EVENT_NOT_FOUND", `Receipt did not emit FanActionRecorded for ${payload.actionId}`, false);
    this.assertRecordedEvent(recorded.args, payload);
    const [record, easAddress] = await Promise.all([
      this.getAction(payload.actionId as Hash),
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "eas" }),
    ]);
    this.assertRecord(record, payload);
    const refs: CredentialRef[] = linked.map((item) => ({ nftContract: item.nftContract as Address, tokenId: item.tokenId, kind: item.kind, issuanceKey: item.issuanceKey as Hash, linkOrigin: item.linkOrigin }));
    this.assertCredentials(refs, linked, payload, receipt.logs);
    const credentialRefsHash = this.credentialRefsHash(refs);
    const origin = payload.operation === 2 ? origins.HISTORICAL : origins.NATIVE;
    const easData = encodeAbiParameters([
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint16" },
      { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" },
    ], [payload.occurrenceId as Hash, payload.actionId as Hash, payload.request.revision, payload.request.actionCode, payload.request.schemaVersion, payload.request.policyVersion, payload.environmentId as Hash, payload.request.creatorId as Hash, payload.request.campaignId as Hash, payload.request.occurredDay, origin, payload.request.evidenceCommitment as Hash, credentialRefsHash, payload.request.migrationBatchId as Hash]);
    if (keccak256(easData).toLowerCase() !== record.recordHash.toLowerCase()) throw new WorkerError("ACTION_RECORD_HASH_MISMATCH", "EAS payload hash does not match Hub recordHash", false);
    const [attestation, easValid] = await Promise.all([
      this.client.readContract({ address: easAddress, abi: easAbi, functionName: "getAttestation", args: [record.easUID] }),
      this.client.readContract({ address: easAddress, abi: easAbi, functionName: "isAttestationValid", args: [record.easUID] }),
    ]);
    const zero = `0x${"0".repeat(64)}`;
    if (!easValid || attestation.uid.toLowerCase() !== record.easUID.toLowerCase()
      || attestation.schema.toLowerCase() !== payload.schemaUid.toLowerCase()
      || getAddress(attestation.recipient) !== getAddress(payload.request.fan)
      || getAddress(attestation.attester) !== getAddress(this.options.hubAddress)
      || attestation.refUID.toLowerCase() !== zero
      || attestation.expirationTime !== 0n || attestation.revocationTime !== 0n || !attestation.revocable
      || attestation.data.toLowerCase() !== easData.toLowerCase()) {
      throw new WorkerError("EAS_ATTESTATION_MISMATCH", "EAS attestation does not match the canonical action result", false);
    }
    return { txHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, transactionIndex: receipt.transactionIndex, hubLogIndex: recorded.logIndex, easUid: record.easUID, recordHash: record.recordHash, credentialRefsHash, credentials: linked.map((item) => ({ ...item, metadataUri: payload.intents.find((intent) => intent.issuanceKey.toLowerCase() === item.issuanceKey.toLowerCase())?.metadataUri ?? "" })), inclusionStatus: "included" };
  }

  private async assertBinding(payload: Omit<CanonicalActionPayloadV1, "occurrenceId" | "actionId" | "requestHash" | "workerSubmission"> | CanonicalActionPayloadV1): Promise<void> {
    if (payload.chainId !== this.options.chainId || getAddress(payload.hubProxy) !== getAddress(this.options.hubAddress)) throw new WorkerError("ACTION_RUNTIME_BINDING_MISMATCH", "Action chain or Hub proxy does not match worker runtime", false);
    const [environmentId, schemaUid, ...bindings] = await Promise.all([
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "environmentId" }),
      this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "getSchema", args: [payload.request.schemaVersion] }),
      ...payload.intents.map((intent) => this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "getAssetBinding", args: [payload.request.bindingVersion, intent.kind] })),
    ]);
    if (environmentId.toLowerCase() !== payload.environmentId.toLowerCase() || schemaUid.toLowerCase() !== payload.schemaUid.toLowerCase()) throw new WorkerError("ACTION_RUNTIME_BINDING_MISMATCH", "Action environment or schema does not match Hub configuration", false);
    payload.intents.forEach((intent, index) => {
      if (getAddress(bindings[index] as Address) !== getAddress(intent.nftContract)) throw new WorkerError("ACTION_ASSET_BINDING_MISMATCH", `Credential kind ${intent.kind} target differs from Hub binding`, false);
    });
  }

  private requestTuple(payload: Pick<CanonicalActionPayloadV1, "request">) {
    const r = payload.request;
    return { ...r, sourceOccurrence: r.sourceOccurrence as Hash, creatorId: r.creatorId as Hash, campaignId: r.campaignId as Hash, evidenceCommitment: r.evidenceCommitment as Hash, migrationBatchId: r.migrationBatchId as Hash, fan: getAddress(r.fan) } as const;
  }
  private intentTuples(payload: Pick<CanonicalActionPayloadV1, "intents">) {
    return payload.intents.map((intent) => ({ kind: intent.kind, mode: intent.mode, issuanceKey: intent.issuanceKey as Hash, tokenId: BigInt(intent.tokenId), metadataUri: intent.metadataUri }));
  }
  private calldata(payload: CanonicalActionPayloadV1): Hex {
    const req = this.requestTuple(payload); const intents = this.intentTuples(payload);
    if (payload.operation === 0) return encodeFunctionData({ abi: actionHubAbi, functionName: "recordOnly", args: [req] });
    if (payload.operation === 1) return encodeFunctionData({ abi: actionHubAbi, functionName: "recordAndIssue", args: [req, intents] });
    return encodeFunctionData({ abi: actionHubAbi, functionName: "importHistorical", args: [req, intents, payload.migrationProof as readonly Hash[]] });
  }

  private async validateEnvelope(payload: CanonicalActionPayloadV1, signed: Hex): Promise<void> {
    const transaction = parseTransaction(signed as Parameters<typeof parseTransaction>[0]);
    const sender = await recoverTransactionAddress({ serializedTransaction: signed as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] });
    if (transaction.chainId !== payload.chainId || getAddress(transaction.to!) !== getAddress(payload.hubProxy) || (transaction.value ?? 0n) !== 0n || getAddress(sender) !== getAddress(this.account.address) || transaction.data?.toLowerCase() !== this.calldata(payload).toLowerCase()) throw new WorkerError("PREPARED_ACTION_TRANSACTION_MISMATCH", "Stored signed action transaction differs from its canonical payload", false);
    const decoded = decodeFunctionData({ abi: actionHubAbi, data: transaction.data });
    if (!decoded.functionName) throw new WorkerError("PREPARED_ACTION_TRANSACTION_MISMATCH", "Action transaction calldata is undecodable", false);
  }

  private async getAction(actionId: Hash): Promise<ActionRecord> {
    return await this.client.readContract({ address: this.options.hubAddress, abi: actionHubAbi, functionName: "getAction", args: [actionId] }) as ActionRecord;
  }
  private assertRecord(record: ActionRecord, payload: CanonicalActionPayloadV1): void {
    const expectedOrigin = payload.operation === 2 ? origins.HISTORICAL : origins.NATIVE;
    if (record.status !== 2 || record.actionId.toLowerCase() !== payload.actionId.toLowerCase() || record.occurrenceId.toLowerCase() !== payload.occurrenceId.toLowerCase() || record.requestHash.toLowerCase() !== payload.requestHash.toLowerCase() || record.schemaUID.toLowerCase() !== payload.schemaUid.toLowerCase() || getAddress(record.fan) !== getAddress(payload.request.fan) || record.revision !== payload.request.revision || record.actionCode !== payload.request.actionCode || record.schemaVersion !== payload.request.schemaVersion || record.policyVersion !== payload.request.policyVersion || record.origin !== expectedOrigin || record.migrationBatchId.toLowerCase() !== payload.request.migrationBatchId.toLowerCase()) throw new WorkerError("ACTION_RECORD_MISMATCH", "Hub action record does not match canonical payload", false);
  }
  private assertRecordedEvent(args: Record<string, unknown>, payload: CanonicalActionPayloadV1): void {
    const expectedOrigin = payload.operation === 2 ? origins.HISTORICAL : origins.NATIVE;
    if (String(args.actionId).toLowerCase() !== payload.actionId.toLowerCase() || String(args.occurrenceId).toLowerCase() !== payload.occurrenceId.toLowerCase() || getAddress(String(args.fan)) !== getAddress(payload.request.fan) || String(args.creatorId).toLowerCase() !== payload.request.creatorId.toLowerCase() || String(args.campaignId).toLowerCase() !== payload.request.campaignId.toLowerCase() || Number(args.revision) !== payload.request.revision || Number(args.schemaVersion) !== payload.request.schemaVersion || Number(args.policyVersion) !== payload.request.policyVersion || Number(args.occurredDay) !== payload.request.occurredDay || Number(args.origin) !== expectedOrigin || String(args.migrationBatchId).toLowerCase() !== payload.request.migrationBatchId.toLowerCase()) throw new WorkerError("ACTION_EVENT_MISMATCH", "FanActionRecorded fields do not match canonical payload", false);
  }
  private assertCredentials(refs: readonly CredentialRef[], linked: readonly ActionCredentialReceipt[], payload: CanonicalActionPayloadV1, logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[]): void {
    if (refs.length !== payload.intents.length || linked.length !== payload.intents.length) throw new WorkerError("ACTION_CREDENTIAL_COUNT_MISMATCH", "Receipt does not contain the complete credential set", false);
    for (const intent of payload.intents) {
      const ref = refs.find((item) => item.kind === intent.kind && item.issuanceKey.toLowerCase() === intent.issuanceKey.toLowerCase());
      const event = linked.find((item) => item.kind === intent.kind && item.issuanceKey.toLowerCase() === intent.issuanceKey.toLowerCase());
      if (!ref || !event || getAddress(ref.nftContract) !== getAddress(intent.nftContract) || getAddress(event.nftContract) !== getAddress(intent.nftContract) || ref.tokenId !== event.tokenId || ref.linkOrigin !== event.linkOrigin) throw new WorkerError("ACTION_CREDENTIAL_MISMATCH", `Credential ${intent.issuanceKey} does not match its intent`, false);
      const expectedOrigin = intent.mode === 0 ? linkOrigins.MINTED_NOW : linkOrigins.LINKED_EXISTING;
      if (event.linkOrigin !== expectedOrigin || (intent.mode === 1 && event.tokenId !== BigInt(intent.tokenId))) throw new WorkerError("ACTION_CREDENTIAL_MISMATCH", `Credential ${intent.issuanceKey} link origin or token id is invalid`, false);
      if (intent.mode === 0 && !this.hasMintLog(logs, intent.kind, intent.nftContract, intent.issuanceKey, event.tokenId, payload.request.fan, intent.metadataUri)) throw new WorkerError("ACTION_MINT_EVENT_NOT_FOUND", `Credential ${intent.issuanceKey} has no matching mint event`, false);
    }
  }
  private hasMintLog(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], kind: number, contract: string, key: string, tokenId: bigint, fan: string, uri: string): boolean {
    const abi = kind === credentialKinds.PASSPORT ? passportEventAbi : kind === credentialKinds.STAMP ? stampEventAbi : collectibleEventAbi;
    for (const log of logs) {
      if (getAddress(log.address) !== getAddress(contract)) continue;
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        const args = decoded.args as { passportId?: Hash; issuanceId?: Hash; claimKey?: Hash; tokenId: bigint; to: Address; metadataUri: string };
        if ((args.passportId ?? args.issuanceId ?? args.claimKey)?.toLowerCase() === key.toLowerCase() && args.tokenId === tokenId && getAddress(args.to) === getAddress(fan) && args.metadataUri === uri) return true;
      } catch { /* unrelated */ }
    }
    return false;
  }
  private credentialRefsHash(refs: readonly CredentialRef[]): Hash {
    const sorted = [...refs].sort((a, b) => BigInt(a.nftContract) < BigInt(b.nftContract) ? -1 : BigInt(a.nftContract) > BigInt(b.nftContract) ? 1 : a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0);
    return keccak256(encodeAbiParameters([{ type: "tuple[]", components: credentialRefComponents }], [sorted]));
  }
}
