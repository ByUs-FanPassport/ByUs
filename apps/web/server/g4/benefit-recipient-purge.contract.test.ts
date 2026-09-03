import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260903022500_phase4_recipient_purge.sql",
  ),
  "utf8",
);

describe("Phase 4 recipient purge contract", () => {
  it("purges only completed shipping or pickup recipients at the exact 30 day boundary", () => {
    expect(sql).toContain("purge_due_benefit_recipient_private");
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("shipping_completed");
    expect(sql).toContain("pickup_completed");
    expect(sql).toMatch(/e\.created_at\s*<=\s*p_now\s*-\s*interval '30 days'/);
    expect(sql).toContain("limit 100");
  });

  it("keeps non-PII purge evidence without copying recipient values", () => {
    expect(sql).toContain("access_type");
    expect(sql).toContain("'purged'");
    expect(sql).not.toMatch(/jsonb_build_object[\s\S]*r\.(name|phone|address1)/);
    expect(sql).not.toMatch(/insert into public\.benefit_recipient_access_audits[\s\S]*\b(name|phone|postal_code|address1|address2)\b/);
  });

  it("is service-only and records a non-PII maintenance monitor", () => {
    expect(sql).toContain("benefit_maintenance_runs");
    expect(sql).toContain("last_error_code");
    expect(sql).toContain("record_benefit_recipient_purge_run");
    expect(sql).toContain("revoke all on function public.purge_due_benefit_recipient_private");
    expect(sql).toContain("to service_role");
  });
});
