import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260721010000_content_foundation.sql"),
  "utf8",
);

describe("content migration access contract", () => {
  it.each([
    "celebrities",
    "celebrity_localizations",
    "themes",
    "theme_localizations",
    "celebrity_themes",
    "celebrity_social_links",
  ])("keeps private table %s behind RLS and revoked browser grants", (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(
      `revoke all on public.${table} from public, anon, authenticated`,
    );
  });

  it("exposes only the explicit published projection", () => {
    expect(sql).toContain("create view public.published_celebrities");
    expect(sql).toContain("where c.status = 'published'");
    expect(sql).toContain(
      "grant select on public.published_celebrities to anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(/select\s+c\.\*/i);
  });

  it("requires complete ko and en data before publication", () => {
    expect(sql).toContain("published celebrity requires complete ko and en localizations");
    expect(sql).toContain("published theme requires complete ko and en localizations");
    expect(sql).toContain("enum_range(null::public.content_locale)");
  });
});
