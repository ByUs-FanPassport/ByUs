import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721093500_g5_engagement_analytics.sql",
  ),
  "utf8",
).toLowerCase();
const engagementSql = sql.slice(
  sql.indexOf("create function public.build_admin_engagement_metrics"),
  sql.indexOf("create function public.read_admin_creator_analytics"),
);

describe("G5 real engagement analytics contract", () => {
  it("uses truthful event-participation denominators and bounded windows", () => {
    expect(sql).toContain("'attendancecount'");
    expect(sql).toContain("'reservationcount'");
    expect(sql).toContain("counts.attendances::numeric/counts.reservations");
    expect(sql).toContain("counts.surveys::numeric/counts.attendances");
    expect(sql).toContain("p_to>p_as_of");
    expect(sql).toMatch(/live\.starts_at >= p_from and live\.starts_at < p_to/);
    expect(sql).toContain("reservation.reserved_at <= p_as_of");
    expect(sql).toContain("attendance.attended_at <= p_as_of");
    expect(sql).toContain("response.submitted_at <= p_as_of");
  });
  it("aggregates only canonical structured survey answers and suppresses small cohorts", () => {
    for (const key of [
      "overall_satisfaction",
      "purchase_intent",
      "future_interest",
      "small_cohort_lt_5",
    ])
      expect(sql).toContain(key);
    expect(sql).toContain("counts.surveys < 5");
    expect(sql).toContain("add column semantic_value text");
    expect(sql).toContain("option.semantic_value='yes'");
    expect(sql).toContain("common survey option semantic value is immutable");
    expect(sql).not.toMatch(/purchase_intent' and option\.position\s*=\s*1/);
    expect(engagementSql).not.toContain("answer.free_text");
    expect(engagementSql).not.toContain("'freetext'");
    expect(engagementSql).not.toContain("'freecomment'");
  });
  it("distinguishes measured zero, not applicable, and suppression", () => {
    expect(sql).toContain("'state','available','value',counts.attendances");
    expect(sql).toContain("'state','not_applicable','value',null");
    expect(sql).toContain("'state','suppressed','value',null");
  });
  it("rechecks active actor identity and creator/brand live ownership", () => {
    expect(sql).toContain("actor.status='active'");
    expect(sql).toContain("actor.verified_email=allowlist.email");
    expect(sql).toContain("celebrity_id=p_celebrity_id");
    expect(sql).toContain("brand_id=p_brand_id");
    expect(sql).toContain("allowlist.role in ('admin','operator','viewer')");
  });
  it("revokes legacy service rpc access and keeps new projections service-only", () => {
    expect(sql).toContain(
      "revoke execute on function public.read_admin_creator_analytics(uuid,uuid,uuid,timestamptz",
    );
    expect(sql).toContain(
      "grant execute on function public.read_admin_creator_analytics(uuid,uuid,uuid,uuid,timestamptz",
    );
  });
});
