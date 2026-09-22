import { describe, expect, it, vi } from "vitest";
import { ViemActionFinalityReader } from "../src/action-finality.js";
import type { PublicClient } from "viem";

const h = (v: string) => `0x${v.repeat(64)}`.slice(0, 66);
const stored = { txHash: h("1"), blockNumber: "10", blockHash: h("2") };

describe("action finality reader", () => {
  it("marks a canonical receipt finalized only when the RPC finalized tag covers it", async () => {
    const client = { getTransactionReceipt: vi.fn().mockResolvedValue({ blockHash: h("2"), blockNumber: 10n }), getBlock: vi.fn().mockImplementation(({ blockTag, blockNumber }) => Promise.resolve(blockNumber !== undefined ? { number: blockNumber, hash: h("2") } : { number: blockTag === "finalized" ? 10n : 11n })) };
    await expect(new ViemActionFinalityReader({ rpcUrl: "http://localhost:8545", chainId: 91342, client: client as unknown as PublicClient }).classify(stored)).resolves.toBe("finalized");
  });
  it("marks changed block inclusion orphaned and never estimates finality when tags are unsupported", async () => {
    const reorg = { getTransactionReceipt: vi.fn().mockResolvedValue({ blockHash: h("3"), blockNumber: 10n }), getBlock: vi.fn() };
    await expect(new ViemActionFinalityReader({ rpcUrl: "http://localhost:8545", chainId: 91342, client: reorg as unknown as PublicClient }).classify(stored)).resolves.toBe("orphaned");
    const unsupported = { getTransactionReceipt: vi.fn().mockResolvedValue({ blockHash: h("2"), blockNumber: 10n }), getBlock: vi.fn().mockImplementation(({ blockNumber }) => blockNumber !== undefined ? Promise.resolve({ number: 10n, hash: h("2") }) : Promise.reject(new Error("unsupported"))) };
    await expect(new ViemActionFinalityReader({ rpcUrl: "http://localhost:8545", chainId: 91342, client: unsupported as unknown as PublicClient }).classify(stored)).resolves.toBe("included");
  });
  it("reads safe and finalized heads once for an invocation", async () => {
    const client = { getTransactionReceipt: vi.fn().mockResolvedValue({ blockHash: h("2"), blockNumber: 10n }), getBlock: vi.fn().mockImplementation(({ blockTag, blockNumber }) => Promise.resolve(blockNumber !== undefined ? { number: blockNumber, hash: h("2") } : { number: blockTag === "finalized" ? 9n : 10n })) };
    const reader = new ViemActionFinalityReader({ rpcUrl: "http://localhost:8545", chainId: 91342, client: client as unknown as PublicClient });
    await expect(reader.classify(stored)).resolves.toBe("safe");
    await expect(reader.classify(stored)).resolves.toBe("safe");
    expect(client.getBlock.mock.calls.filter(([args]) => args.blockTag)).toHaveLength(2);
  });
});
