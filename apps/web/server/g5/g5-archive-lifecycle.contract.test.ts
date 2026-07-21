import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260721081500_g5_archive_lifecycle.sql"),
  "utf8",
).toLowerCase();

describe("G5 archive lifecycle database contract", () => {
  it("adds explicit archive evidence and complete attribution to every shipped content root", () => {
    for (const table of ["celebrities", "brands", "live_events", "benefits"]) {
      expect(sql).toContain(`alter table public.${table}`);
    }
    expect(sql.match(/add column ever_published_at timestamptz/g)).toHaveLength(4);
    expect(sql.match(/add column archived_at timestamptz/g)).toHaveLength(4);
    expect(sql.match(/add column archived_by_admin_allowlist_id uuid/g)).toHaveLength(4);
    expect(sql.match(/add column archive_reason text/g)).toHaveLength(4);
  });

  it("latches first-publication evidence and makes archived roots immutable", () => {
    expect(sql).toContain("first publication evidence is immutable");
    expect(sql).toContain("first publication evidence requires a publication transition");
    expect(sql).toContain("old.ever_published_at is null and new_status = 'published'");
    expect(sql).toContain("archived content is immutable");
    expect(sql).toContain("content archive requires the lifecycle command");
    expect(sql).toContain("set status = 'draft', archived_at = now()");
    expect(sql).toContain("set publication_status = 'draft', archived_at = now()");
  });

  it("requires active role-checked administrators and writes correlated audit evidence", () => {
    expect(sql).toContain("allowlist.active");
    expect(sql).toContain("for update");
    expect(sql).toContain("allowlist.role in ('admin', 'operator')");
    expect(sql).toContain("p_hard_delete and allowlist.role = 'admin'");
    expect(sql).toContain("'content.archived'");
    expect(sql).toContain("'content.draft_deleted'");
    expect(sql).toContain("p_correlation_id");
    expect(sql.match(/normalized_reason is null or length\(normalized_reason\) not between 10 and 1000/g)).toHaveLength(2);
    expect(sql).toContain("insert into public.audit_logs");
  });

  it("allows hard deletion only for never-published unreferenced drafts", () => {
    expect(sql).toContain("target_row->>'status' <> 'draft'");
    expect(sql).toContain("target_row->>'publication_status' <> 'draft'");
    expect(sql).toContain("target_row->>'ever_published_at' is not null");
    expect(sql).toContain("published or referenced content must be archived");
    expect(sql).toContain("from public.live_reservations where live_event_id = p_entity_id");
    expect(sql).toContain("from public.live_attendances where live_event_id = p_entity_id");
    expect(sql).toContain("from public.benefit_claims where benefit_id = p_entity_id");
    expect(sql).toContain("from public.fan_passports where celebrity_id = p_entity_id");
  });

  it("removes direct hard-delete access and exposes only service command RPCs", () => {
    expect(sql).toContain("revoke delete on public.celebrities, public.brands, public.live_events, public.benefits");
    expect(sql).toContain("grant execute on function public.archive_admin_content");
    expect(sql).toContain("grant execute on function public.hard_delete_admin_content");
    expect(sql).not.toMatch(/grant delete on public\.(celebrities|brands|live_events|benefits)/);
  });

  it("does not couple this migration to the concurrently developed survey schema", () => {
    expect(sql).not.toContain("public.surveys");
    expect(sql).not.toContain("survey_id");
  });
});
