import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260721064500_g5_audit_log_read_model.sql"),
  "utf8",
).toLowerCase();

describe("G5 ADM-012 audit log read model contract", () => {
  it("makes the shared audit table immutable including truncate", () => {
    expect(sql).toContain("before update or delete on public.audit_logs");
    expect(sql).toContain("before truncate on public.audit_logs");
    expect(sql).toContain("audit logs are append-only");
    expect(sql).toContain("revoke update, delete, truncate on public.audit_logs");
    expect(sql).not.toMatch(/grant\s+(?:update|delete|truncate).*public\.audit_logs/);
  });

  it("exposes only an active-admin, service-role read RPC", () => {
    expect(sql).toContain("create or replace function public.read_admin_audit_logs");
    expect(sql).toContain("allowlist.active = true");
    expect(sql).toContain("security definer");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });

  it("uses a deterministic tuple cursor and every required filter", () => {
    expect(sql).toContain("(logs.created_at, logs.id) < (p_cursor_created_at, p_cursor_id)");
    expect(sql).toContain("order by logs.created_at desc, logs.id desc");
    for (const parameter of ["p_actor_id", "p_entity_type", "p_entity_id", "p_action", "p_result", "p_created_from", "p_created_to", "p_correlation_id"]) {
      expect(sql).toContain(parameter);
    }
  });

  it("recursively redacts secrets and fan PII before projection", () => {
    expect(sql).toContain("public.redact_audit_summary(item.entry_value)");
    for (const marker of ["email", "wallet", "token", "fan", "benefit", "quiz", "answer", "selected"]) {
      expect(sql).toContain(marker);
    }
    expect(sql).toContain("[redacted]");
  });
});
