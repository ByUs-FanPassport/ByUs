import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260903040000_phase6_platform_analytics.sql"),
  "utf8",
);

describe("Phase 6 shared analytics policy", () => {
  it("delegates Tier calculation and validates the canonical window", () => {
    expect(sql).toContain("fan_level_for_score");
    expect(sql).toContain("[from,to)");
    expect(sql).toContain("p_to > p_as_of");
    expect(sql).not.toMatch(/when\s+[^\n]*(?:>=\s*5|>=\s*10|>=\s*20|>=\s*35)/i);
  });
});

