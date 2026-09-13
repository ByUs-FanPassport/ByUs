import { decodeFunctionData, parseTransaction, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import { actionHubAbi, ViemActionHubAdapter } from "../src/adapters/viem-action-hub.js";
import type { CanonicalActionPayloadV1 } from "../src/action-domain.js";

const h = (v: string) => `0x${v.repeat(64)}`.slice(0, 66);
const address = (v: string) => `0x${v.repeat(40)}`.slice(0, 42);
const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;
const hub = address("2") as `0x${string}`; const environment = h("3"); const schema = h("4"); const nft = address("5");
const payload: CanonicalActionPayloadV1 = {
  version: 1, chainId: 91342, environmentId: environment, hubProxy: hub, schemaUid: schema, operation: 1,
  request: { sourceOccurrence: h("6"), revision: 1, actionCode: 3, schemaVersion: 1, policyVersion: 1, fan: address("7"), creatorId: h("8"), campaignId: h("9"), occurredDay: 20_000, evidenceCommitment: h("a"), migrationBatchId: h("0"), bindingVersion: 1 },
  occurrenceId: h("b"), actionId: h("c"), requestHash: h("d"), migrationProof: [],
  intents: [{ kind: 1, mode: 0, nftContract: nft, issuanceKey: h("e"), tokenId: "0", metadataUri: "ipfs://attendance" }],
};

function adapter(client: Record<string, unknown>) {
  return new ViemActionHubAdapter({ rpcUrl: "http://localhost:8545", chainId: 91342, privateKey, hubAddress: hub, deploymentBlock: 1n, client: client as unknown as PublicClient });
}

describe("ViemActionHubAdapter signed request integrity", () => {
  it("signs the exact canonical request and rejects field mutation before receipt lookup", async () => {
    const client = {
      readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
        if (functionName === "environmentId") return environment;
        if (functionName === "getSchema") return schema;
        if (functionName === "getAssetBinding") return nft;
        throw new Error(`unexpected ${functionName}`);
      }),
      getTransactionCount: vi.fn().mockResolvedValue(4), estimateGas: vi.fn().mockResolvedValue(300_000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
      getTransactionReceipt: vi.fn(),
    };
    const chain = adapter(client);
    const submission = await chain.prepare(payload);
    const transaction = parseTransaction(submission.signedTransaction as Parameters<typeof parseTransaction>[0]);
    const decoded = decodeFunctionData({ abi: actionHubAbi, data: transaction.data! });
    expect(decoded.functionName).toBe("recordAndIssue");
    expect((decoded.args?.[0] as { actionCode: number }).actionCode).toBe(3);
    expect(decoded.args?.[1]).toHaveLength(1);

    await expect(chain.receipt({ ...payload, request: { ...payload.request, campaignId: h("f") } }, submission)).rejects.toMatchObject({ code: "PREPARED_ACTION_TRANSACTION_MISMATCH", retryable: false });
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
