import { describe, expect, it } from "vitest";
import {
  BENEFIT_DRAW_ALGORITHM,
  rankWeightedCandidates,
} from "./weighted-draw";

const benefitId = "11111111-1111-4111-8111-111111111111";
const fanA = "22222222-2222-4222-8222-222222222222";
const fanB = "33333333-3333-4333-8333-333333333333";

describe("sha256-weighted-rank-v1", () => {
  it("uses the fixed bytes/formula and stable fan-id tie breaker", () => {
    expect(BENEFIT_DRAW_ALGORITHM).toBe("sha256-weighted-rank-v1");
    const result = rankWeightedCandidates(
      new Uint8Array(32).fill(7),
      benefitId,
      [{ appUserId: fanA, weight: 4 }],
    );
    expect(result[0]?.digest).toBe(
      "7817a56aca0a7b23636a11b8c1cba6e4ab9bd0dbed2ea1e91331eb6a3b4531ae",
    );
    expect(result[0]?.uniform).toBeGreaterThan(0);
    expect(result[0]?.uniform).toBeLessThan(1);
    expect(result[0]?.rank).toBeCloseTo(-Math.log(result[0]!.uniform) / 4, 14);
  });

  it("keeps one fan independently eligible for different Benefits", () => {
    const seed = new Uint8Array(32).fill(11);
    expect(rankWeightedCandidates(seed, benefitId, [{ appUserId: fanA, weight: 1 }])).toHaveLength(1);
    expect(rankWeightedCandidates(seed, "44444444-4444-4444-8444-444444444444", [{ appUserId: fanA, weight: 1 }])).toHaveLength(1);
  });

  it("approaches the declared 4:1 weighted odds over deterministic seeds", () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const seed = new Uint8Array(32);
      new DataView(seed.buffer).setUint32(28, i);
      const winner = rankWeightedCandidates(seed, benefitId, [
        { appUserId: fanA, weight: 4 },
        { appUserId: fanB, weight: 1 },
      ])[0]?.appUserId;
      if (winner === fanA) a += 1;
      else b += 1;
    }
    expect(a / b).toBeGreaterThan(3.6);
    expect(a / b).toBeLessThan(4.4);
  });

  it("rejects malformed seed, UUIDs, non-positive weights, and invalid quantity", () => {
    expect(() => rankWeightedCandidates(new Uint8Array(31), benefitId, [], 0)).toThrow();
    expect(() => rankWeightedCandidates(new Uint8Array(32), "bad", [], 1)).toThrow();
    expect(() => rankWeightedCandidates(new Uint8Array(32), benefitId, [{ appUserId: fanA, weight: 0 }], 1)).toThrow();
    expect(() => rankWeightedCandidates(new Uint8Array(32), benefitId, [], -1)).toThrow();
  });
});
