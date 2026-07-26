import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260726193000_katseye_fan_count_display.sql",
  ),
  "utf8",
);

describe("KATSEYE public fan-count migration", () => {
  it("updates only the canonical KATSEYE row and fails closed otherwise", () => {
    expect(migration).toContain("set fan_count = 6800000");
    expect(migration).toContain(
      "id = 'ca75e1e0-0000-4000-8000-000000000001'",
    );
    expect(migration).toContain("and slug = 'katseye'");
    expect(migration).toContain("get diagnostics updated_count = row_count");
    expect(migration).toContain("if updated_count <> 1 then");
  });
});
