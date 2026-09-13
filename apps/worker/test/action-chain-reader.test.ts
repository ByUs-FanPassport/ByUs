import { expect, it, vi } from "vitest";
import type { PublicClient, Hash, Address } from "viem";
import { ViemActionLogReader } from "../src/action-chain-reader.js";
const environment = `0x${"11".repeat(32)}` as Hash;
const hub = `0x${"22".repeat(20)}` as Address;
it.each(["chain", "environment"])("rejects mislabeled %s before loading actions", async (mismatch) => {
  const client = {
    getChainId: vi.fn().mockResolvedValue(mismatch === "chain" ? 1 : 91342),
    readContract: vi.fn().mockResolvedValue(mismatch === "environment" ? `0x${"33".repeat(32)}` : environment),
    getLogs: vi.fn(),
  };
  const reader = new ViemActionLogReader({ rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: hub, fromBlock: 0n, client: client as unknown as PublicClient });
  await expect(reader.read(environment)).rejects.toThrow("binding mismatch");
  expect(client.getLogs).not.toHaveBeenCalled();
});
