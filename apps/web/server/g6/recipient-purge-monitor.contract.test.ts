import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260903041300_phase6_recipient_purge_monitor.sql"), "utf8");
describe("recipient purge monitor SQL", () => {
  it("reports cadence, last success, and latest error independently", () => {
    expect(sql).toContain("'cadenceHours',24");
    expect(sql).toContain("max(finished_at)");
    expect(sql).toContain("latest.last_error_code");
    expect(sql).toContain("benefit_maintenance_runs");
    expect(sql).toContain("assert_blockchain_job_admin_actor");
  });
});
