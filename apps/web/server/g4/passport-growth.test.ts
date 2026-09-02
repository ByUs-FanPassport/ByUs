import { describe, expect, it } from "vitest";
import { derivePassportProgress } from "./passport-growth";

describe("Passport growth projection", () => {
  it.each([
    [0, "Bronze", "Silver", 15, 15, 0, false],
    [14, "Bronze", "Silver", 15, 1, 93, false],
    [15, "Silver", "Gold", 50, 35, 30, false],
    [50, "Gold", "Platinum", 120, 70, 42, false],
    [120, "Platinum", "Diamond", 250, 130, 48, false],
    [250, "Diamond", null, null, 0, 100, true],
  ] as const)("derives canonical progress at score %i", (score, level, nextLevel, nextThreshold, remainingPoints, percent, maxed) => {
    expect(derivePassportProgress(score, level)).toStrictEqual({
      currentScore: score, currentLevel: level, nextLevel, nextThreshold,
      remainingPoints, percent, maxed,
    });
  });

  it("preserves an attained pre-cutover Tier until v2 score advances it", () => {
    expect(derivePassportProgress(10, "Gold")).toMatchObject({
      currentLevel: "Gold", nextLevel: "Platinum", nextThreshold: 120,
    });
    expect(derivePassportProgress(50, "Bronze")).toMatchObject({ currentLevel: "Gold" });
  });
});
