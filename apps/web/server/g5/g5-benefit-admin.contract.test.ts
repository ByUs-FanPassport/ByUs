import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  "../../supabase/migrations/20260721087500_g5_benefit_cms.sql",
  "utf8",
);
const manager = readFileSync(
  "../../apps/web/components/admin/benefit-manager.tsx",
  "utf8",
);
describe("ADM-007 migration contract", () => {
  it("supports both allocation modes and application-bound decisions", () => {
    expect(sql).toContain("direct_claim', 'application_selection");
    expect(sql).toContain("benefit_application_id");
    expect(sql).toContain("submitted application binding is required");
    expect(sql).toContain("decision_idempotency_key");
    expect(sql).toContain("selection idempotency key mismatch");
    expect(sql).not.toContain("byus.admin_selection");
    expect(sql).toContain("benefit revision conflict");
  });
  it("keeps claims, applications, and usage immutable to service role", () => {
    expect(sql).toContain("benefit_claims_reject_update_delete");
    expect(sql).toContain("benefit_usage_reject_update_delete");
    expect(sql).toContain(
      "revoke insert,update,delete on public.benefit_applications from service_role",
    );
    expect(sql).toContain("benefit history is append-only");
  });
  it("never includes code values in audit summaries", () => {
    const auditLines = sql
      .split("\n")
      .filter((line) => line.includes("audit_logs"));
    expect(auditLines.join("\n")).not.toContain("code_value");
    expect(sql).toContain("duplicateCount");
  });
  it("rechecks active identity and validates full applicant eligibility", () => {
    expect(sql).toContain("u.verified_email=a.email");
    expect(sql).toContain("u.status='active'");
    expect(sql).toContain("assert_benefit_application_eligibility");
    expect(sql).toContain("required activity is missing");
  });
  it("supports safe code clearing and bounded usage timestamps", () => {
    expect(sql).toContain(
      "clear unique-code inventory before changing delivery type",
    );
    expect(sql).toContain("clear_admin_benefit_codes");
    expect(sql).toContain("p_used_at>now()");
    expect(sql).toContain("claimed_at<=p_used_at");
  });
  it("keeps delivery secrets one-way and rejected decisions claim-free", () => {
    expect(manager).toContain('setForm((current) => ({ ...current, deliverySecret: "" }))');
    expect(sql).toContain("claim_id uuid;");
    expect(sql).not.toContain("claim_id uuid:=extensions.gen_random_uuid()");
    expect(sql).toContain("if p_selected then\n   claim_id:=extensions.gen_random_uuid();");
  });
});
