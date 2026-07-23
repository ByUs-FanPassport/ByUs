import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722010000_public_celebrity_display_order.sql",
  ),
  "utf8",
);
const hardeningSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722145659_harden_public_discovery_views.sql",
  ),
  "utf8",
);

describe("public celebrity display-order projection", () => {
  it("keeps administrator order in the safe published-only view", () => {
    expect(sql).toContain("create or replace view public.published_celebrities");
    expect(sql).toContain("c.display_order");
    expect(sql).toContain("where c.status = 'published'");
    expect(sql).not.toMatch(/select\s+c\.\*/i);
    const publicSelect = sql.slice(sql.indexOf("select"), sql.indexOf("from public.celebrities"));
    expect(publicSelect).not.toMatch(/c\.(?:id|created_at|updated_at|published_at)/i);
  });

  it("keeps the final projections invoker-safe and server-only", () => {
    expect(hardeningSql).toContain("set (security_invoker = true)");
    expect(hardeningSql).toContain(
      "from public, anon, authenticated",
    );
    expect(hardeningSql).toContain(
      "grant select on public.published_celebrities to service_role",
    );
    expect(hardeningSql).toContain(
      "grant select on public.published_celebrity_live_summaries to service_role",
    );
    expect(hardeningSql).not.toMatch(/grant select[^;]+to\s+(?:anon|authenticated)/i);
  });

  it("projects only published current or upcoming LIVE summaries", () => {
    expect(sql).toContain("create view public.published_celebrity_live_summaries");
    expect(sql).toContain("live.publication_status = 'published'");
    expect(sql).toContain("celebrity.status = 'published'");
    expect(sql).toContain("brand.status = 'published'");
    expect(sql).toContain("effective.status in ('scheduled', 'live')");
    expect(sql).toContain("live.archived_at is null");
  });
});
