import { describe, expect, it } from "vitest";
import { groupSignups, percentChange } from "./admin-overview";

describe("overview growth", () => {
  it("does not invent a percent when the baseline is zero", () => {
    expect(percentChange(7, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(0, 5)).toBe(-100);
    expect(percentChange(15, 10)).toBe(50);
  });
  it("groups Monday weeks across the month boundary without losing zero days", () => {
    const points = [{ date: "2026-08-30", signups: 1 }, { date: "2026-08-31", signups: 0 }, { date: "2026-09-01", signups: 3 }];
    expect(groupSignups(points, "day")).toEqual(points);
    expect(groupSignups(points, "week")).toEqual([{ date: "2026-08-24", signups: 1 }, { date: "2026-08-31", signups: 3 }]);
    expect(groupSignups(points, "month")).toEqual([{ date: "2026-08-01", signups: 1 }, { date: "2026-09-01", signups: 3 }]);
  });
});
