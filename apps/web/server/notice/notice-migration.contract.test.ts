import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260726010000_celebrity_notice_cms.sql"), "utf8");

describe("Celebrity Notice CMS migration", () => {
  it("defines localized JSON content, publication validation, stable public ordering, and RLS", () => {
    expect(sql).toContain("create table public.celebrity_notices");
    expect(sql).toContain("create table public.celebrity_notice_localizations");
    expect(sql).toContain("body_json jsonb not null");
    expect(sql).toContain("published notice requires complete ko and en localizations");
    expect(sql).toContain("pinned desc, published_at desc, id desc");
    expect(sql).toContain("alter table public.celebrity_notices enable row level security");
  });

  it("uses active-admin RPCs and keeps rich content out of audit summaries", () => {
    expect(sql).toContain("perform public.assert_active_admin");
    expect(sql).toContain("save_admin_celebrity_notice");
    expect(sql).toContain("set_admin_celebrity_notice_state");
    const audit = sql.match(/jsonb_build_object\('beforeStatus'[\s\S]*?\)\);/)?.[0] ?? "";
    expect(audit).not.toContain("body_json");
  });
});
