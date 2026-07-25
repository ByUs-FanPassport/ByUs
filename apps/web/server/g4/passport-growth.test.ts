import { describe, expect, it } from "vitest";
import { derivePassportProgress } from "./passport-growth";

describe("Passport growth projection", () => {
  it.each([
    [0, "Bronze", "Silver", 5, 5, 0, false],
    [4, "Bronze", "Silver", 5, 1, 80, false],
    [5, "Silver", "Gold", 10, 5, 50, false],
    [10, "Gold", "Platinum", 20, 10, 50, false],
    [20, "Platinum", "Diamond", 35, 15, 57, false],
    [35, "Diamond", null, null, 0, 100, true],
  ] as const)("derives canonical progress at score %i", (score, level, nextLevel, nextThreshold, remainingPoints, percent, maxed) => {
    expect(derivePassportProgress(score, level)).toStrictEqual({
      currentScore: score, currentLevel: level, nextLevel, nextThreshold,
      remainingPoints, percent, maxed,
    });
  });

  it("fails closed when the database score and projected level drift", () => {
    expect(() => derivePassportProgress(5, "Bronze")).toThrow("Passport score and level are inconsistent");
  });
});
