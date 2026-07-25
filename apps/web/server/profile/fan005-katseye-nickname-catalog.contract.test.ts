import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260726023000_katseye_nickname_catalog.sql",
  ),
  "utf8",
);

describe("FAN-005 KATSEYE nickname catalog migration", () => {
  it("adds both current public entity names as impersonation matches", () => {
    expect(sql).toMatch(
      /\('fan-nickname-v1', 'katseye', 'contains', 'impersonation'\)/i,
    );
    expect(sql).toContain(
      "('fan-nickname-v1', '캣츠아이', 'contains', 'impersonation')",
    );
  });

  it("is additive and idempotent without rewriting existing profiles", () => {
    expect(sql).toMatch(
      /on conflict \(catalog_version, value_normalized, match_mode\)/i,
    );
    expect(sql).toMatch(/active = true/i);
    expect(sql).not.toMatch(
      /(update|delete from)\s+public\.user_profiles/i,
    );
  });
});
