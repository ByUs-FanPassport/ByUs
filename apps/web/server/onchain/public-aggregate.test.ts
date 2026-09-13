import { describe, expect, it } from "vitest";
import type { FinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { projectPublicOnchainSnapshot } from "./public-aggregate";
import { onchainConfig as config } from "./public-config";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const fan = "0x0000000000000000000000000000000000000001";
function action(overrides: Record<string, unknown> = {}) {
  return {
    chainId: config.chainId, occurrenceId: hash(1), actionId: hash(2), revision: 1, actionCode: 10,
    recipient: fan, originalRecipient: fan, environmentId: config.environmentId, hubProxy: config.hubAddress, schemaUid: config.schemaUid,
    easAttester: config.hubAddress, easRecipient: fan, easRevocationTime: 0n, easExpirationTime: 0n,
    easIsAttestationValid: true, status: "ACTIVE", origin: "NATIVE", finality: "finalized", txHash: hash(3),
    creatorId: hash(4), campaignId: hash(0), occurredDay: 20000, easUid: hash(5), blockNumber: 100n, blockHash: hash(6),
    credentials: [{ credentialKey: hash(7), kind: 1, linkOrigin: 0, nftContract: config.assets[1], tokenId: "323" }],
    ...overrides,
  };
}
function snapshot(actions = [action()], transactions = [{ txHash: hash(3), blockNumber: 100n, blockHash: hash(6), kind: "record", actionIds: [hash(2)], recipients: [fan], origin: "NATIVE" }]) {
  return { blockNumber: 101n, blockHash: hash(8), timestamp: 1789300000n, actions, lifecycleTransactions: transactions } as FinalizedActionSnapshot;
}

describe("public chain-only projection", () => {
  it("keeps one original mint and three lifecycle transactions across correction", () => {
    const old = action({ status: "INVALIDATED", easRevocationTime: 1n, easIsAttestationValid: false });
    const next = action({ revision: 2, actionId: hash(9), txHash: hash(10), credentials: [{ ...old.credentials[0], linkOrigin: 1 }] });
    const source = snapshot([old, next]);
    source.lifecycleTransactions.push({ ...source.lifecycleTransactions[0], txHash: hash(11), kind: "invalidate" }, { ...source.lifecycleTransactions[0], txHash: hash(10), kind: "correct" });
    const result = projectPublicOnchainSnapshot(source);
    expect(result.business).toMatchObject({ uniqueActiveWallets: 1, actionCounts: { 10: 1 }, mintedCredentials: 1, lifecycleTransactions: 3, currentActionTransactions: 1 });
    expect(result.actions.map((a) => a.current)).toEqual([false, true]);
  });
  it.each([true, false])("excludes the whole QA occurrence even when recipient changes (QA first=%s)", (qaFirst) => {
    const qa = config.qaWallets[0];
    const old = action({ recipient: qaFirst ? qa : fan, easRecipient: qaFirst ? qa : fan, status: "INVALIDATED", easRevocationTime: 1n, easIsAttestationValid: false });
    const next = action({ recipient: qaFirst ? fan : qa, easRecipient: qaFirst ? fan : qa, revision: 2, actionId: hash(9), credentials: [{ ...old.credentials[0], linkOrigin: 1 }] });
    const result = projectPublicOnchainSnapshot(snapshot([old, next]));
    expect(result.business).toMatchObject({ uniqueActiveWallets: 0, actionCounts: {}, mintedCredentials: 0, lifecycleTransactions: 0 });
    expect(result.raw.mintedCredentials).toBe(1);
    expect(result.excludedQaActions).toBe(1);
    expect(result.actions.every((a) => a.qa)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("biz@");
  });
  it("shows historical records in raw evidence without inflating native fan metrics", () => {
    const source = snapshot([action({ origin: "HISTORICAL" })]);
    source.lifecycleTransactions[0].origin = "HISTORICAL";
    const result = projectPublicOnchainSnapshot(source);
    expect(result.business.mintedCredentials).toBe(0);
    expect(result.business.lifecycleTransactions).toBe(0);
    expect(result.raw.actionCounts[10]).toBe(1);
    expect(result.historicalActions).toBe(1);
  });
  it("uses the block timestamp for expiry, not the later server time", () => {
    const result = projectPublicOnchainSnapshot(snapshot([action({ easExpirationTime: 1789300001n })]), new Date("2030-01-01"));
    expect(result.business.uniqueActiveWallets).toBe(1);
    expect(result.blockTimestamp).toBe(new Date(1789300000000).toISOString());
  });
});
