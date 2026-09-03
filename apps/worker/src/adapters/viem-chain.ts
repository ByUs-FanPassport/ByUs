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
  stringToHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { WorkerError, type CollectiblePayloadV1, type EntityType, type JobPayload, type PreparedSubmission } from "../domain.js";
import type { ChainPort, MintReceipt, PreparedMint } from "../ports.js";

const passportAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "passportId", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "function", name: "tokenByPassportId", stateMutability: "view", inputs: [{ name: "passportId", type: "bytes32" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "event", name: "PassportMinted", inputs: [{ indexed: true, name: "passportId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] },
] as const;

const stampAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "issuanceId", type: "bytes32" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "function", name: "tokenByIssuanceId", stateMutability: "view", inputs: [{ name: "issuanceId", type: "bytes32" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { type: "event", name: "StampMinted", inputs: [{ indexed: true, name: "issuanceId", type: "bytes32" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "metadataUri", type: "string" }] },
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
  client?: PublicClient;
}

export class ViemChainAdapter implements ChainPort {
  private readonly account;
  private readonly client: PublicClient;
  private readonly passportAddress: Address;
  private readonly stampAddress: Address;
  private readonly collectibleAddress: Address | undefined;

  constructor(private readonly options: ViemChainOptions) {
    const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
    this.account = privateKeyToAccount(options.privateKey);
    this.client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 2 }) });
    this.passportAddress = getAddress(options.passportAddress);
    this.stampAddress = getAddress(options.stampAddress);
    this.collectibleAddress = options.collectibleAddress ? getAddress(options.collectibleAddress) : undefined;
  }

  private requireCollectibleConfig(): { address: Address; deploymentBlock: bigint } {
    if (!this.collectibleAddress || this.options.collectibleDeploymentBlock === undefined) {
      throw new WorkerError("COLLECTIBLE_CHAIN_NOT_CONFIGURED", "Collectible chain binding is not configured", true);
    }
    return { address: this.collectibleAddress, deploymentBlock: this.options.collectibleDeploymentBlock };
  }

  private decodeCollectibleSubmission(payload: CollectiblePayloadV1, submission: PreparedSubmission): { claimKey: Hash; metadataUri: string } {
    const { address } = this.requireCollectibleConfig();
    const claimKey = keccak256(stringToHex(payload.claimId.toLowerCase()));
    if (keccak256(submission.signedTransaction as Hex).toLowerCase() !== submission.txHash.toLowerCase()) {
      throw new WorkerError("COLLECTIBLE_RECEIPT_MISMATCH", "Collectible signed transaction hash mismatch", false);
    }
    const transaction = parseTransaction(submission.signedTransaction as Hex);
    if (!transaction.to || getAddress(transaction.to) !== address) throw new WorkerError("COLLECTIBLE_RECEIPT_MISMATCH", "Collectible transaction target mismatch", false);
    const decoded = decodeFunctionData({ abi: collectibleAbi, data: transaction.data ?? "0x" });
    if (decoded.functionName !== "mint") throw new WorkerError("COLLECTIBLE_RECEIPT_MISMATCH", "Collectible calldata mismatch", false);
    const [recipient, submittedKey, metadataUri] = decoded.args;
    if (getAddress(recipient) !== getAddress(payload.recipient) || submittedKey !== claimKey) throw new WorkerError("COLLECTIBLE_RECEIPT_MISMATCH", "Collectible calldata identity mismatch", false);
    return { claimKey, metadataUri };
  }

  async findExisting(entityType: EntityType, payload: JobPayload): Promise<MintReceipt | null> {
    if (entityType === "collectible") {
      const config = this.requireCollectibleConfig();
      const collectible = payload as CollectiblePayloadV1;
      const claimKey = keccak256(stringToHex(collectible.claimId.toLowerCase()));
      try {
        const tokenId = await this.client.readContract({ address: config.address, abi: collectibleAbi, functionName: "tokenByClaimId", args: [claimKey] });
        if (tokenId === 0n) return null;
        if (!collectible.workerSubmission) throw new WorkerError("COLLECTIBLE_UNEXPECTED_EXISTING_MINT", `Collectible ${tokenId} exists without the prepared canonical submission`, false);
        const expected = this.decodeCollectibleSubmission(collectible, collectible.workerSubmission);
        const [owner, metadataUri, logs] = await Promise.all([
          this.client.readContract({ address: config.address, abi: collectibleAbi, functionName: "ownerOf", args: [tokenId] }),
          this.client.readContract({ address: config.address, abi: collectibleAbi, functionName: "tokenURI", args: [tokenId] }),
          this.client.getLogs({ address: config.address, event: collectibleAbi[4], args: { claimKey }, fromBlock: config.deploymentBlock, toBlock: "latest" }),
        ]);
        const log = logs.at(-1);
        if (!log?.transactionHash || log.args.claimKey !== expected.claimKey || log.args.tokenId !== tokenId || getAddress(log.args.to!) !== getAddress(collectible.recipient) || getAddress(owner) !== getAddress(collectible.recipient) || log.args.metadataUri !== expected.metadataUri || metadataUri !== expected.metadataUri) {
          throw new WorkerError("COLLECTIBLE_CHAIN_STATE_MISMATCH", `Collectible ${tokenId} does not match its approved identity`, false);
        }
        return { txHash: log.transactionHash, tokenId };
      } catch (error) {
        if (error instanceof WorkerError) throw error;
        throw new WorkerError("GIWA_RPC_READ_FAILED", error instanceof Error ? error.message : String(error), true, { cause: error });
      }
    }
    const isPassport = entityType === "passport";
    const key = isPassport ? (payload as Extract<JobPayload, { passportId: string }>).passportId : (payload as Extract<JobPayload, { issuanceId: string }>).issuanceId;
    const address = isPassport ? this.passportAddress : this.stampAddress;
    const abi = isPassport ? passportAbi : stampAbi;
    const functionName = isPassport ? "tokenByPassportId" : "tokenByIssuanceId";
    try {
      const tokenId = await this.client.readContract({ address, abi, functionName, args: [key as Hash] });
      if (tokenId === 0n) return null;
      const logs = await this.client.getLogs({ address, event: abi[2], args: isPassport ? { passportId: key as Hash } : { issuanceId: key as Hash }, fromBlock: this.options.deploymentBlock, toBlock: "latest" });
      const log = logs.at(-1);
      if (!log?.transactionHash) throw new WorkerError("MINT_EVENT_NOT_FOUND", `Token ${tokenId} exists but its mint event was not found`, true);
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
      return { txHash: keccak256(signedTransaction), signedTransaction };
    } catch (error) {
      throw new WorkerError("GIWA_PREPARE_FAILED", error instanceof Error ? error.message : String(error), true, { cause: error });
    }
  }

  async broadcast(signedTransaction: string): Promise<string> {
    try {
      return await this.client.sendRawTransaction({ serializedTransaction: signedTransaction as Hex });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already known")) return keccak256(signedTransaction as Hex);
      throw new WorkerError("GIWA_BROADCAST_FAILED", message, true, { cause: error });
    }
  }

  async receipt(txHash: string, entityType: EntityType, payload: JobPayload, submission: PreparedSubmission): Promise<MintReceipt | null> {
    try {
      if (txHash.toLowerCase() !== submission.txHash.toLowerCase()) {
        throw new WorkerError("TRANSACTION_HASH_MISMATCH", "Receipt lookup hash did not match the prepared submission", false);
      }
      const receipt = await this.client.getTransactionReceipt({ hash: txHash as Hash });
      if (receipt.status !== "success") throw new WorkerError("GIWA_TRANSACTION_REVERTED", `Transaction reverted: ${txHash}`, false);
      if (entityType === "collectible") {
        const config = this.requireCollectibleConfig();
        const collectible = payload as CollectiblePayloadV1;
        const { claimKey, metadataUri } = this.decodeCollectibleSubmission(collectible, submission);
        for (const log of receipt.logs) {
          if (getAddress(log.address) !== config.address) continue;
          try {
            const decoded = decodeEventLog({ abi: collectibleAbi, data: log.data, topics: log.topics });
            if (decoded.eventName === "CollectibleMinted" && decoded.args.claimKey === claimKey && getAddress(decoded.args.to) === getAddress(collectible.recipient) && decoded.args.metadataUri === metadataUri) return { txHash, tokenId: decoded.args.tokenId };
          } catch { /* unrelated log */ }
        }
        throw new WorkerError("MINT_EVENT_NOT_FOUND", `Successful transaction did not emit the expected CollectibleMinted event: ${txHash}`, false);
      }
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: log.address.toLowerCase() === this.passportAddress.toLowerCase() ? passportAbi : stampAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "PassportMinted" || decoded.eventName === "StampMinted") return { txHash, tokenId: decoded.args.tokenId };
        } catch { /* unrelated log */ }
      }
      throw new WorkerError("MINT_EVENT_NOT_FOUND", `Successful transaction did not emit a ByUs mint event: ${txHash}`, false);
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("could not be found") || message.includes("not found")) return null;
      throw new WorkerError("GIWA_RECEIPT_FAILED", message, true, { cause: error });
    }
  }
}
