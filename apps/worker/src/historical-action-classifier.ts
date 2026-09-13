import { encodeAbiParameters, keccak256, type Hash } from "viem";
import { z } from "zod";

export type HistoricalClassification = "H1_LINK_EXISTING" | "H2_MINT_MISSING" | "H3_RECORD_ONLY" | "H4_PARTIAL" | "Q_QUARANTINE";

export interface HistoricalCredentialEvidence {
  issuanceKey: string;
  state: "CHAIN_VERIFIED" | "MISSING" | "PENDING_SUBMISSION" | "FAILED_UNRESOLVED" | "OWNER_MISMATCH" | "URI_MISMATCH";
  eligibleForMint: boolean;
}

export interface HistoricalActionEvidence {
  sourceExists: boolean;
  contextVerified: boolean;
  publicContextApproved: boolean;
  credentialPolicy: "REQUIRED" | "NONE";
  credentials: readonly HistoricalCredentialEvidence[];
  approvedSingleManifestItem?: boolean | undefined;
}

export interface HistoricalDryRunResult {
  classification: HistoricalClassification;
  executable: boolean;
  newMintCount: number;
  reasons: string[];
}

const ambiguousStates = new Set<HistoricalCredentialEvidence["state"]>([
  "PENDING_SUBMISSION", "FAILED_UNRESOLVED", "OWNER_MISMATCH", "URI_MISMATCH",
]);

export function classifyHistoricalAction(input: HistoricalActionEvidence): HistoricalDryRunResult {
  const reasons: string[] = [];
  if (!input.sourceExists) reasons.push("SOURCE_MISSING");
  if (!input.contextVerified) reasons.push("CONTEXT_UNVERIFIED");
  if (!input.publicContextApproved) reasons.push("PUBLIC_CONTEXT_NOT_APPROVED");
  for (const credential of input.credentials) {
    if (ambiguousStates.has(credential.state)) reasons.push(`${credential.state}:${credential.issuanceKey}`);
    if (credential.state === "MISSING" && !credential.eligibleForMint) reasons.push(`MINT_NOT_ELIGIBLE:${credential.issuanceKey}`);
  }
  if (reasons.length > 0) return { classification: "Q_QUARANTINE", executable: false, newMintCount: 0, reasons };

  if (input.credentialPolicy === "NONE") {
    if (input.credentials.length !== 0) {
      return { classification: "Q_QUARANTINE", executable: false, newMintCount: 0, reasons: ["UNEXPECTED_CREDENTIALS"] };
    }
    return { classification: "H3_RECORD_ONLY", executable: true, newMintCount: 0, reasons: [] };
  }
  if (input.credentials.length === 0) {
    return { classification: "Q_QUARANTINE", executable: false, newMintCount: 0, reasons: ["REQUIRED_CREDENTIALS_MISSING"] };
  }
  const verified = input.credentials.filter((item) => item.state === "CHAIN_VERIFIED").length;
  const missing = input.credentials.filter((item) => item.state === "MISSING").length;
  if (verified === input.credentials.length) {
    return { classification: "H1_LINK_EXISTING", executable: true, newMintCount: 0, reasons: [] };
  }
  if (missing === input.credentials.length) {
    return { classification: "H2_MINT_MISSING", executable: true, newMintCount: missing, reasons: [] };
  }
  return input.approvedSingleManifestItem
    ? { classification: "H2_MINT_MISSING", executable: true, newMintCount: missing, reasons: ["APPROVED_MIXED_LINK_AND_MINT"] }
    : { classification: "H4_PARTIAL", executable: false, newMintCount: missing, reasons: ["MIXED_LINK_AND_MINT_REQUIRES_APPROVED_SINGLE_MANIFEST_ITEM"] };
}

const evidenceSchema = z.object({
  sourceExists: z.boolean(), contextVerified: z.boolean(), publicContextApproved: z.boolean(),
  credentialPolicy: z.enum(["REQUIRED", "NONE"]), approvedSingleManifestItem: z.boolean().optional(),
  credentials: z.array(z.object({
    issuanceKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    state: z.enum(["CHAIN_VERIFIED", "MISSING", "PENDING_SUBMISSION", "FAILED_UNRESOLVED", "OWNER_MISMATCH", "URI_MISMATCH"]),
    eligibleForMint: z.boolean(),
  }).strict()),
}).strict();
const dryRunInputSchema = z.array(z.object({
  itemId: z.string().min(1),
  evidence: evidenceSchema,
  canonical: z.object({
    migrationBatchId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    environmentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    actionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    requestHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }).strict().optional(),
}).strict());

export function buildHistoricalDryRunReport(input: unknown) {
  const items = dryRunInputSchema.parse(input).map((item) => {
    const result = classifyHistoricalAction(item.evidence);
    const manifestLeaf = item.canonical && result.executable
      ? keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
        [item.canonical.migrationBatchId as Hash, item.canonical.environmentId as Hash, item.canonical.actionId as Hash, item.canonical.requestHash as Hash],
      ))
      : null;
    return { itemId: item.itemId, ...result, canonical: item.canonical ?? null, manifestLeaf };
  });
  return {
    dryRun: true,
    items,
    totals: items.reduce<Record<string, number>>((acc, item) => {
      acc[item.classification] = (acc[item.classification] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
