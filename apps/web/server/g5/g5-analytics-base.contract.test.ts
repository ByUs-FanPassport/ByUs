import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721080000_g5_analytics_base.sql"), "utf8").toLowerCase();

describe("G5 ADM-008/009 analytics SQL reconciliation contract", () => {
  it("uses measured source rows with exact [from,to) boundaries and distinct reservation users", () => {
    expect(sql).toContain("count(distinct reservation.app_user_id)");
    expect(sql).toMatch(/reserved_at\s*>=\s*p_from/);
    expect(sql).toMatch(/reserved_at\s*<\s*p_to/);
    expect(sql).toMatch(/issued_at\s*>=\s*p_from/);
    expect(sql).toMatch(/issued_at\s*<\s*p_to/);
    expect(sql).toContain("'semantics', '[from,to)'");
  });

  it("rejects cross-scope live filters for both creator and brand views", () => {
    expect(sql).toContain("id = p_live_event_id and celebrity_id = p_celebrity_id");
    expect(sql).toContain("id = p_live_event_id and brand_id = p_brand_id");
    expect(sql).toContain("analytics live scope does not belong to celebrity");
    expect(sql).toContain("analytics live scope does not belong to brand");
  });

  it("reconciles level zero and exact 5, 10, 20, and 35 thresholds at as-of", () => {
    expect(sql).toContain("coalesce(sum(ledger.points), 0)");
    expect(sql).toContain("ledger.created_at <= p_as_of");
    for (const range of ["points between 0 and 4", "points between 5 and 9", "points between 10 and 19", "points between 20 and 34", "points >= 35"]) {
      expect(sql).toContain(range);
    }
  });

  it("keeps missing stages unavailable with null values instead of fake zero", () => {
    for (const reason of ["attendance_source_not_implemented", "survey_source_not_implemented", "manual_commerce_source_not_implemented"]) {
      expect(sql).toContain(reason);
    }
    expect(sql).toMatch(/'state', 'unavailable', 'value', null/);
    expect(sql).not.toMatch(/attendanceusers'.{0,120}'value',\s*0/s);
  });

  it("is aggregate-only, active-admin guarded, and service-role exclusive", () => {
    expect(sql).toContain("allowlist.active = true");
    expect(sql).toContain("security definer");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("email");
    expect(sql).not.toContain("wallet");
  });
});
