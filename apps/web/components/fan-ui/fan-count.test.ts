import { describe, expect, it } from "vitest";

import { formatFanCount } from "./fan-count";

describe("formatFanCount", () => {
  it("uses one shared compact English fan-count contract", () => {
    expect(formatFanCount(6_800_000)).toBe("6.8M Fans");
    expect(formatFanCount(0)).toBe("0 Fans");
  });
});
