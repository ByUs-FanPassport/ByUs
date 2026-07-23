import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260723090000_celebrity_fan_count.sql",
  ),
  "utf8",
);

describe("celebrity fan count migration", () => {
  it("stores only nullable non-negative integer counts for drafts", () => {
    expect(sql).toContain("add column fan_count bigint");
    expect(sql).toContain("fan_count is null or fan_count >= 0");
  });

  it("backfills the approved published celebrity counts", () => {
    expect(sql).toContain("when 'kara' then 12800000");
    expect(sql).toContain("when 'elina' then 3200000");
    expect(sql).toContain("when 'changha' then 1450000");
    expect(sql).toContain("published celebrity fan_count backfill required");
  });

  it("keeps the public projection service-role-only and requires fan count for publication", () => {
    expect(sql).toContain("security_invoker = true");
    expect(sql).toContain(
      "revoke all on public.published_celebrities from anon, authenticated",
    );
    expect(sql).toContain(
      "grant select on public.published_celebrities to service_role",
    );
    expect(sql).toContain("celebrity publication requires fan count");
  });

  it("includes fan count in CMS reads, writes, and audit snapshots", () => {
    expect(sql).toContain("'fanCount', c.fan_count");
    expect(sql).toContain("fan_count = requested_fan_count");
    expect(sql).toContain(
      "jsonb_build_object('before', before_row, 'after', result)",
    );
  });
});
