import { describe, expect, it } from "vitest";
import { crossedFanLevels, isFanProgressEventType } from "./score-unlock-event";

describe("SCORE-006 domain policy", () => {
  it("returns every newly crossed level in order", () => {
    expect(crossedFanLevels(14, 250)).toEqual([
      "Silver",
      "Gold",
      "Platinum",
      "Diamond",
    ]);
    expect(crossedFanLevels(49, 120)).toEqual(["Gold", "Platinum"]);
  });

  it.each([
    [0, 14, []], [14, 15, ["Silver"]], [15, 49, []],
    [49, 50, ["Gold"]], [50, 119, []], [119, 120, ["Platinum"]],
    [120, 249, []], [249, 250, ["Diamond"]],
  ] as const)("applies Tier v2 boundary %i -> %i", (before, after, expected) => {
    expect(crossedFanLevels(before, after)).toEqual(expected);
  });

  it("does not classify score decreases or unchanged scores as upgrades", () => {
    expect(crossedFanLevels(20, 10)).toEqual([]);
    expect(crossedFanLevels(10, 10)).toEqual([]);
  });

  it("recognizes only the two progress event API kinds", () => {
    expect(isFanProgressEventType("level_up")).toBe(true);
    expect(isFanProgressEventType("benefit_unlocked")).toBe(true);
    expect(isFanProgressEventType("benefit_available")).toBe(false);
  });
});
