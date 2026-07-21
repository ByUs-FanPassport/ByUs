import { describe, expect, it } from "vitest";
import { crossedFanLevels, isFanProgressEventType } from "./score-unlock-event";

describe("SCORE-006 domain policy", () => {
  it("returns every newly crossed level in order", () => {
    expect(crossedFanLevels(4, 35)).toEqual([
      "Silver",
      "Gold",
      "Platinum",
      "Diamond",
    ]);
    expect(crossedFanLevels(9, 20)).toEqual(["Gold", "Platinum"]);
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
