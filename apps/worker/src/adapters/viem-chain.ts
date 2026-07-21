import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { WorkerError, type EntityType, type JobPayload } from "../domain.js";
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

interface ViemChainOptions {
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  passportAddress: Address;
  stampAddress: Address;
  deploymentBlock: bigint;
}

export class ViemChainAdapter implements ChainPort {
  private readonly account;
  private readonly client: PublicClient;
  private readonly passportAddress: Address;
  private readonly stampAddress: Address;

  constructor(private readonly options: ViemChainOptions) {
    const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
    this.account = privateKeyToAccount(options.privateKey);
    this.client = createPublicClient({ chain, transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 2 }) });
    this.passportAddress = getAddress(options.passportAddress);
    this.stampAddress = getAddress(options.stampAddress);
  }

  async findExisting(entityType: EntityType, payload: JobPayload): Promise<MintReceipt | null> {
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
    const isPassport = entityType === "passport";
    const key = isPassport ? (payload as Extract<JobPayload, { passportId: string }>).passportId : (payload as Extract<JobPayload, { issuanceId: string }>).issuanceId;
    const address = isPassport ? this.passportAddress : this.stampAddress;
    const abi = isPassport ? passportAbi : stampAbi;
    try {
      const data = encodeFunctionData({ abi, functionName: "mint", args: [payload.recipient as Address, key as Hash, metadataUri] });
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

  async receipt(txHash: string): Promise<MintReceipt | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash: txHash as Hash });
      if (receipt.status !== "success") throw new WorkerError("GIWA_TRANSACTION_REVERTED", `Transaction reverted: ${txHash}`, false);
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
