import { describe, expect, it } from "vitest";
import { aggregateFanActionMetrics, type IndexedFanAction, type MetricTrustBoundary } from "../src/action-metrics.js";
import { buildHistoricalDryRunReport, classifyHistoricalAction } from "../src/historical-action-classifier.js";

const h = (v: string) => `0x${v.repeat(64)}`.slice(0, 66);
const address = (v: string) => `0x${v.repeat(40)}`.slice(0, 42);
const boundary: MetricTrustBoundary = { chainId: 91342, environmentId: h("1"), hubProxy: address("2"), schemaUid: h("3"), asOfEpochSeconds: 2_000_000_000n };
function action(overrides: Partial<IndexedFanAction> = {}): IndexedFanAction {
  return { chainId: 91342, occurrenceId: h("4"), actionId: h("5"), revision: 1, actionCode: 1, recipient: address("6"), environmentId: h("1"), hubProxy: address("2"), schemaUid: h("3"), easAttester: address("2"), easRecipient: address("6"), easRevocationTime: 0n, easExpirationTime: 0n, easIsAttestationValid: true, status: "ACTIVE", origin: "NATIVE", finality: "finalized", txHash: h("7"), credentials: [{ credentialKey: h("8"), kind: 0, linkOrigin: 0, nftContract: address("9"), tokenId: "1" }], ...overrides };
}

describe("fan action read model", () => {
  it("keeps a corrected historical occurrence out of native totals", () => {
    const rows = [action({ origin: "HISTORICAL", status: "INVALIDATED" }), action({ origin: "HISTORICAL", revision: 2, actionId: h("a") })];
    const metrics = aggregateFanActionMetrics(rows, boundary);
    expect(metrics.actionCounts[1]).toBeUndefined();
    expect(metrics.historicalActions).toBe(1);
    expect(aggregateFanActionMetrics(rows, boundary, { includeHistorical: true }).actionCounts[1]).toBe(1);
  });

  it("filters foreign issuers before latest revision and keeps invalid latest from falling back", () => {
    const valid = action();
    const foreignHigher = action({ revision: 99, hubProxy: address("a"), easAttester: address("a") });
    expect(aggregateFanActionMetrics([valid, foreignHigher], boundary).actionCounts[1]).toBe(1);
    expect(aggregateFanActionMetrics([valid, action({ revision: 2, status: "INVALIDATED" })], boundary).actionCounts[1]).toBeUndefined();
  });

  it("does not promote revoked, expired, unfinalized, or historical actions into native headline metrics", () => {
    const rows = [action({ occurrenceId: h("a"), easRevocationTime: 1n }), action({ occurrenceId: h("b"), finality: "safe" }), action({ occurrenceId: h("c"), origin: "HISTORICAL" }), action({ occurrenceId: h("d"), easExpirationTime: 1n })];
    expect(aggregateFanActionMetrics(rows, boundary).uniqueActiveWallets).toBe(0);
    expect(aggregateFanActionMetrics(rows, boundary).historicalActions).toBe(1);
    expect(aggregateFanActionMetrics(rows, boundary, { includeHistorical: true }).uniqueActiveWallets).toBe(1);
  });
});

describe("historical dry-run", () => {
  const verified = { issuanceKey: h("a"), state: "CHAIN_VERIFIED" as const, eligibleForMint: false };
  const missing = { issuanceKey: h("b"), state: "MISSING" as const, eligibleForMint: true };
  it("quarantines unresolved submissions and holds mixed intents until one manifest item is approved", () => {
    expect(classifyHistoricalAction({ sourceExists: true, contextVerified: true, publicContextApproved: true, credentialPolicy: "REQUIRED", credentials: [{ ...missing, state: "PENDING_SUBMISSION" }] }).classification).toBe("Q_QUARANTINE");
    expect(classifyHistoricalAction({ sourceExists: true, contextVerified: true, publicContextApproved: true, credentialPolicy: "REQUIRED", credentials: [verified, missing] }).classification).toBe("H4_PARTIAL");
    expect(classifyHistoricalAction({ sourceExists: true, contextVerified: true, publicContextApproved: true, credentialPolicy: "REQUIRED", credentials: [verified, missing], approvedSingleManifestItem: true })).toMatchObject({ classification: "H2_MINT_MISSING", executable: true, newMintCount: 1 });
  });
  it("emits manifest leaves only for executable evidence with canonical hashes", () => {
    const report = buildHistoricalDryRunReport([{ itemId: "one", evidence: { sourceExists: true, contextVerified: true, publicContextApproved: true, credentialPolicy: "REQUIRED", credentials: [verified] }, canonical: { migrationBatchId: h("1"), environmentId: h("2"), actionId: h("3"), requestHash: h("4") } }]);
    expect(report.dryRun).toBe(true);
    expect(report.items[0]?.manifestLeaf).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
