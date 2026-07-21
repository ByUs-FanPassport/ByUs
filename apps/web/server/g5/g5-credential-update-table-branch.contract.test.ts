import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721113000_credential_update_table_branch_fix.sql"), "utf8");

describe("credential update table branches", () => {
  it("resolves table-specific record fields only inside explicit branches", () => {
    expect(sql).toContain("if tg_table_name = 'fan_passports' then");
    expect(sql).toContain("elsif tg_table_name = 'stamps' then");
    expect(sql).not.toMatch(/tg_table_name\s*=\s*'fan_passports'\s+and\s+new\.quiz_pass_id/i);
    expect(sql).not.toMatch(/tg_table_name\s*=\s*'stamps'\s+and\s*\(/i);
    expect(sql).toContain("credential update trigger attached to unsupported table");
  });
});
