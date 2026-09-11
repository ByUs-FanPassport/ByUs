import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  decodeFunctionData,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { WorkerError, type CollectiblePayloadV1, type EntityType, type JobPayload, type PreparedSubmission } from "../domain.js";
import { assertMintFeePolicy, DEFAULT_MINT_FEE_POLICY, validateMintFeePolicy, type MintFeePolicy } from "../fee-policy.js";
import type { ChainPort, MintReceipt, PreparedMint } from "../ports.js";

const passportAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "passportId", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "function", name: "tokenByPassportId", stateMutability: "view", inputs: [{ name: "passportId", type: "bytes32" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "event", name: "PassportMinted", inputs: [{ indexed: true, name: "passportId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "uri", type: "string" }] },
] as const;

const stampAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "issuanceId", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "function", name: "tokenByIssuanceId", stateMutability: "view", inputs: [{ name: "issuanceId", type: "bytes32" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "event", name: "StampMinted", inputs: [{ indexed: true, name: "issuanceId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "uri", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "uri", type: "string" }] },
] as const;

const collectibleAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "claimKey", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "function", name: "tokenByClaimId", stateMutability: "view", inputs: [{ name: "claimKey", type: "bytes32" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "uri", type: "string" }] },
  { type: "event", name: "CollectibleMinted", inputs: [{ indexed: true, name: "claimKey", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] },
] as const;

export interface ViemChainOptions {
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  passportAddress: Address;
  stampAddress: Address;
  deploymentBlock: bigint;
  collectibleAddress?: Address;
  collectibleDeploymentBlock?: bigint;
  feePolicy?: MintFeePolicy;
  client?: PublicClient;
}

export class ViemChainAdapter implements ChainPort {
  private readonly account;
  private readonly client: PublicClient;
  private readonly passportAddress: Address;
  private readonly stampAddress: Address;
  private readonly collectibleAddress: Address | undefined;
  private readonly feePolicy: MintFeePolicy;
  private readonly approvedTransactions = new Set<string>();

  constructor(private readonly options: ViemChainOptions) {
    const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
    this.account = privateKeyToAccount(options.privateKey);
    this.client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 2 }) });
    this.passportAddress = getAddress(options.passportAddress);
    this.stampAddress = getAddress(options.stampAddress);
    this.collectibleAddress = options.collectibleAddress ? getAddress(options.collectibleAddress) : undefined;
    this.feePolicy = validateMintFeePolicy(options.feePolicy ?? DEFAULT_MINT_FEE_POLICY);
  }

  private requireCollectibleConfig(): { address: Address; deploymentBlock: bigint } {
    if (!this.collectibleAddress || this.options.collectibleDeploymentBlock === undefined) {
      throw new WorkerError("COLLECTIBLE_CHAIN_NOT_CONFIGURED", "Collectible chain binding is not configured", true);
    }
    return { address: this.collectibleAddress, deploymentBlock: this.options.collectibleDeploymentBlock };
  }

  private binding(entityType: EntityType, payload: JobPayload) {
    if (entityType === "collectible") {
      const config = this.requireCollectibleConfig();
      return {
        address: config.address,
        abi: collectibleAbi,
        event: collectibleAbi[4],
        eventName: "CollectibleMinted" as const,
        keyName: "claimKey" as const,
        key: keccak256(stringToHex((payload as CollectiblePayloadV1).claimId.toLowerCase())),
        mappingFunction: "tokenByClaimId" as const,
        deploymentBlock: config.deploymentBlock,
      };
    }
    if (entityType === "passport") {
      return {
        address: this.passportAddress,
        abi: passportAbi,
        event: passportAbi[2],
        eventName: "PassportMinted" as const,
        keyName: "passportId" as const,
        key: (payload as Extract<JobPayload, { passportId: string }>).passportId as Hash,
        mappingFunction: "tokenByPassportId" as const,
        deploymentBlock: this.options.deploymentBlock,
      };
    }
    return {
      address: this.stampAddress,
      abi: stampAbi,
      event: stampAbi[2],
      eventName: "StampMinted" as const,
      keyName: "issuanceId" as const,
      key: (payload as Extract<JobPayload, { issuanceId: string }>).issuanceId as Hash,
      mappingFunction: "tokenByIssuanceId" as const,
      deploymentBlock: this.options.deploymentBlock,
    };
  }

  private mismatch(entityType: EntityType, message: string): WorkerError {
    return new WorkerError(entityType === "collectible" ? "COLLECTIBLE_RECEIPT_MISMATCH" : "PREPARED_TRANSACTION_MISMATCH", message, false);
  }

  private async validateTransactionEnvelope(signedTransaction: Hex, expectedAddress?: Address): Promise<ReturnType<typeof parseTransaction>> {
    let transaction: ReturnType<typeof parseTransaction>;
    try {
      transaction = parseTransaction(signedTransaction);
    } catch (error) {
      throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", error instanceof Error ? error.message : "Stored signed transaction is malformed", false, { cause: error });
    }
    if (transaction.chainId !== this.options.chainId) throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored transaction chain mismatch", false);
    if (!transaction.to) throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored transaction target is missing", false);
    const target = getAddress(transaction.to);
    const allowedTargets = [this.passportAddress, this.stampAddress, this.collectibleAddress].filter((address): address is Address => Boolean(address));
    if (!allowedTargets.includes(target) || (expectedAddress && target !== expectedAddress)) {
      throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored transaction target mismatch", false);
    }
    if ((transaction.value ?? 0n) !== 0n) throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored mint transaction must not transfer value", false);
    if (transaction.nonce === undefined || !Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0) throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored transaction nonce is invalid", false);
    try {
      const signer = await recoverTransactionAddress({ serializedTransaction: signedTransaction as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] });
      if (getAddress(signer) !== getAddress(this.account.address)) throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored transaction signer mismatch", false);
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError("PREPARED_TRANSACTION_MISMATCH", "Stored transaction signature is invalid", false, { cause: error });
    }
    return transaction;
  }

  private async validateSubmission(entityType: EntityType, payload: JobPayload, submission: PreparedSubmission): Promise<{ key: Hash; metadataUri: string }> {
    const signedTransaction = submission.signedTransaction as Hex;
    if (keccak256(signedTransaction).toLowerCase() !== submission.txHash.toLowerCase()) {
      throw this.mismatch(entityType, "Stored signed transaction hash mismatch");
    }
    const binding = this.binding(entityType, payload);
    let transaction: ReturnType<typeof parseTransaction>;
    try {
      transaction = await this.validateTransactionEnvelope(signedTransaction, binding.address);
    } catch (error) {
      if (error instanceof WorkerError) throw this.mismatch(entityType, error.message);
      throw error;
    }
    try {
      const decoded = decodeFunctionData({ abi: binding.abi, data: transaction.data ?? "0x" });
      if (decoded.functionName !== "mint") throw this.mismatch(entityType, "Stored transaction calldata is not a mint");
      const [recipient, submittedKey, metadataUri] = decoded.args;
      if (getAddress(recipient) !== getAddress(payload.recipient) || submittedKey !== binding.key || typeof metadataUri !== "string") {
        throw this.mismatch(entityType, "Stored transaction calldata does not match the job identity");
      }
      return { key: binding.key, metadataUri };
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw this.mismatch(entityType, "Stored transaction calldata is invalid");
    }
  }

  async findExisting(entityType: EntityType, payload: JobPayload): Promise<MintReceipt | null> {
    const binding = this.binding(entityType, payload);
    try {
      const tokenId = await this.client.readContract({ address: binding.address, abi: binding.abi, functionName: binding.mappingFunction, args: [binding.key] });
      if (tokenId === 0n) return null;
      if (entityType === "collectible" && !payload.workerSubmission) {
        throw new WorkerError("COLLECTIBLE_UNEXPECTED_EXISTING_MINT", `Collectible ${tokenId} exists without the prepared canonical submission`, false);
      }
      const expected = payload.workerSubmission ? await this.validateSubmission(entityType, payload, payload.workerSubmission) : null;
      const [ownerOrBalance, metadataUri, logs] = await Promise.all([
        entityType === "stamp" || entityType === "reaction"
          ? this.client.readContract({ address: binding.address, abi: stampAbi, functionName: "balanceOf", args: [payload.recipient as Address, tokenId] })
          : this.client.readContract({ address: binding.address, abi: entityType === "passport" ? passportAbi : collectibleAbi, functionName: "ownerOf", args: [tokenId] }),
        entityType === "stamp" || entityType === "reaction"
          ? this.client.readContract({ address: binding.address, abi: stampAbi, functionName: "uri", args: [tokenId] })
          : this.client.readContract({ address: binding.address, abi: entityType === "passport" ? passportAbi : collectibleAbi, functionName: "tokenURI", args: [tokenId] }),
        this.client.getLogs({ address: binding.address, event: binding.event, args: { [binding.keyName]: binding.key }, fromBlock: binding.deploymentBlock, toBlock: "latest" }),
      ]);
      const log = logs.at(-1);
      if (!log?.transactionHash) {
        throw new WorkerError("MINT_EVENT_NOT_FOUND", `${entityType} token ${tokenId} exists but its mint event was not found`, true);
      }
      const ownsToken = entityType === "stamp" || entityType === "reaction"
        ? ownerOrBalance === 1n
        : getAddress(ownerOrBalance as Address) === getAddress(payload.recipient);
      const args = log.args as { passportId?: Hash; issuanceId?: Hash; claimKey?: Hash; tokenId?: bigint; to?: Address; metadataUri?: string };
      const eventKey = args.passportId ?? args.issuanceId ?? args.claimKey;
      const identityMatches = Boolean(
        log.address
        && getAddress(log.address) === binding.address
        && eventKey === binding.key
        && args.tokenId === tokenId
        && args.to
        && getAddress(args.to) === getAddress(payload.recipient)
        && ownsToken
        && args.metadataUri === metadataUri
        && (!expected || expected.metadataUri === metadataUri),
      );
      if (!identityMatches) {
        const code = entityType === "collectible" ? "COLLECTIBLE_CHAIN_STATE_MISMATCH" : "MINT_CHAIN_STATE_MISMATCH";
        throw new WorkerError(code, `${entityType} token ${tokenId} does not match its approved identity`, false);
      }
      return { txHash: log.transactionHash, tokenId };
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError("GIWA_RPC_READ_FAILED", error instanceof Error ? error.message : String(error), true, { cause: error });
    }
  }

  async prepare(entityType: EntityType, payload: JobPayload, metadataUri: string): Promise<PreparedMint> {
    if (entityType === "collectible") {
      const { address } = this.requireCollectibleConfig();
      const collectible = payload as CollectiblePayloadV1;
      return this.prepareTransaction(address, collectibleAbi, payload.recipient as Address, keccak256(stringToHex(collectible.claimId.toLowerCase())), metadataUri);
    }
    const isPassport = entityType === "passport";
    const key = isPassport ? (payload as Extract<JobPayload, { passportId: string }>).passportId : (payload as Extract<JobPayload, { issuanceId: string }>).issuanceId;
    const address = isPassport ? this.passportAddress : this.stampAddress;
    const abi = isPassport ? passportAbi : stampAbi;
    return this.prepareTransaction(address, abi, payload.recipient as Address, key as Hash, metadataUri);
  }

  private async prepareTransaction(address: Address, abi: typeof passportAbi | typeof stampAbi | typeof collectibleAbi, recipient: Address, key: Hash, metadataUri: string): Promise<PreparedMint> {
    try {
      const data = encodeFunctionData({ abi, functionName: "mint", args: [recipient, key, metadataUri] });
      const [nonce, gas, fees] = await Promise.all([
        this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" }),
        this.client.estimateGas({ account: this.account, to: address, data }),
        this.client.estimateFeesPerGas(),
      ]);
      assertMintFeePolicy({
        type: "eip1559",
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      }, this.feePolicy);
      const signedTransaction = await this.account.signTransaction({
        chainId: this.options.chainId,
        type: "eip1559",
        to: address,
        data,
        nonce,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      const txHash = keccak256(signedTransaction);
      this.approvedTransactions.add(txHash.toLowerCase());
      return { txHash, signedTransaction };
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError("GIWA_PREPARE_FAILED", error instanceof Error ? error.message : String(error), true, { cause: error });
    }
  }

  async broadcast(signedTransaction: string): Promise<string> {
    try {
      const transaction = await this.validateTransactionEnvelope(signedTransaction as Hex);
      assertMintFeePolicy({
        type: transaction.type,
        gas: transaction.gas,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      }, this.feePolicy);
      const txHash = keccak256(signedTransaction as Hex);
      if (!this.approvedTransactions.has(txHash.toLowerCase())) {
        throw new WorkerError("PREPARED_TRANSACTION_NOT_VALIDATED", "Stored signed transaction was not validated against its job before broadcast", false);
      }
      const broadcastHash = await this.client.sendRawTransaction({ serializedTransaction: signedTransaction as Hex });
      this.approvedTransactions.delete(txHash.toLowerCase());
      return broadcastHash;
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already known")) {
        const txHash = keccak256(signedTransaction as Hex);
        this.approvedTransactions.delete(txHash.toLowerCase());
        return txHash;
      }
      throw new WorkerError("GIWA_BROADCAST_FAILED", message, true, { cause: error });
    }
  }

  async receipt(txHash: string, entityType: EntityType, payload: JobPayload, submission: PreparedSubmission): Promise<MintReceipt | null> {
    try {
      if (txHash.toLowerCase() !== submission.txHash.toLowerCase()) {
        throw new WorkerError("TRANSACTION_HASH_MISMATCH", "Receipt lookup hash did not match the prepared submission", false);
      }
      const binding = this.binding(entityType, payload);
      const expected = await this.validateSubmission(entityType, payload, submission);
      const receipt = await this.client.getTransactionReceipt({ hash: txHash as Hash });
      if (receipt.status !== "success") throw new WorkerError("GIWA_TRANSACTION_REVERTED", `Transaction reverted: ${txHash}`, false);
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== binding.address) continue;
        try {
          const decoded = decodeEventLog({ abi: binding.abi, data: log.data, topics: log.topics });
          if (decoded.eventName !== binding.eventName) continue;
          const args = decoded.args as { passportId?: Hash; issuanceId?: Hash; claimKey?: Hash; tokenId: bigint; to: Address; metadataUri: string };
          const eventKey = args.passportId ?? args.issuanceId ?? args.claimKey;
          if (eventKey === expected.key && getAddress(args.to) === getAddress(payload.recipient) && args.metadataUri === expected.metadataUri) {
            return { txHash, tokenId: args.tokenId };
          }
        } catch { /* unrelated log */ }
      }
      throw new WorkerError("MINT_EVENT_NOT_FOUND", `Successful transaction did not emit the expected ${binding.eventName} event: ${txHash}`, false);
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("could not be found") || message.includes("not found")) {
        this.approvedTransactions.add(submission.txHash.toLowerCase());
        return null;
      }
      throw new WorkerError("GIWA_RECEIPT_FAILED", message, true, { cause: error });
    }
  }
}
