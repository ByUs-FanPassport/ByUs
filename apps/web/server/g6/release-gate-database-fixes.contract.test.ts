import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721095000_g6_release_gate_function_fixes.sql",
  ),
  "utf8",
);

describe("G6 production mutation function corrections", () => {
  it("uses a non-keyword timestamp variable for attendance rate limiting", () => {
    expect(sql).toContain("v_now timestamptz");
    expect(sql).toContain("v_now < rate_state.blocked_until");
    expect(sql).not.toContain("current_time timestamptz");
  });

  it("qualifies survey option ownership against an unambiguous question id", () => {
    expect(sql).toContain("v_question_id uuid");
    expect(sql).toContain("option.question_id = v_question_id");
    expect(sql).not.toContain("option.question_id = question_id");
  });

  it("uses distinct local identifiers for celebrity theme writes", () => {
    expect(sql).toContain("v_theme_id uuid");
    expect(sql).toContain("values(v_theme_id,'ko'");
    expect(sql).not.toContain("values(theme_id,'ko'");
  });
});
