import { createHash } from "node:crypto";

export const BENEFIT_DRAW_ALGORITHM = "sha256-weighted-rank-v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UINT256_PLUS_ONE = 1n << 256n;

export interface WeightedCandidateInput {
  appUserId: string;
  weight: number;
}
export interface WeightedCandidateRank extends WeightedCandidateInput {
  digest: string;
  uniform: number;
  rank: number;
}
export interface BenefitDrawResult {
  drawId: string;
  campaignId: string;
  algorithm: typeof BENEFIT_DRAW_ALGORITHM;
  seedHash: string;
  executedAt: string;
  candidateCount: number;
  winners: Array<{
    winnerId: string;
    benefitId: string;
    appUserId: string;
    weight: number;
  }>;
  replayed: boolean;
}

function uuidBytes(value: string): Buffer {
  if (!UUID.test(value)) throw new Error("invalid UUID");
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function rankWeightedCandidates(
  rawSeed: Uint8Array,
  benefitId: string,
  candidates: readonly WeightedCandidateInput[],
  quantity = Math.max(candidates.length, 1),
): WeightedCandidateRank[] {
  if (rawSeed.byteLength !== 32) throw new Error("seed must contain 32 bytes");
  const benefit = uuidBytes(benefitId);
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error("quantity must be positive");
  if (new Set(candidates.map((candidate) => candidate.appUserId)).size !== candidates.length)
    throw new Error("candidate fan must be unique per Benefit");
  return candidates
    .map((candidate) => {
      if (!Number.isSafeInteger(candidate.weight) || candidate.weight <= 0)
        throw new Error("weight must be a positive integer");
      const digest = createHash("sha256")
        .update(Buffer.concat([Buffer.from(rawSeed), benefit, uuidBytes(candidate.appUserId)]))
        .digest("hex");
      const digestInteger = BigInt(`0x${digest}`);
      const uniform = Number(digestInteger + 1n) / Number(UINT256_PLUS_ONE + 1n);
      return {
        ...candidate,
        digest,
        uniform,
        rank: -Math.log(uniform) / candidate.weight,
      };
    })
    .sort((left, right) => left.rank - right.rank || left.appUserId.localeCompare(right.appUserId))
    .slice(0, quantity);
}
