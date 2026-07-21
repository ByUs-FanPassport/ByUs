import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const foundationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721034500_g3_brand_foundation.sql",
  ),
  "utf8",
);

const repairSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721035000_g3_brand_delete_fix.sql",
  ),
  "utf8",
);

describe("G3 brand cascade-delete repair contract", () => {
  it("repairs the assertion forward without rewriting the applied foundation", () => {
    expect(repairSql).toContain(
      "create or replace function public.assert_brand_publishable(target_id uuid)",
    );
    expect(foundationSql).toContain(
      "if current_status <> 'published' then return; end if",
    );
    expect(foundationSql).not.toContain(
      "if current_status is distinct from 'published' then return; end if",
    );
  });

  it("treats draft and missing parents as non-published", () => {
    expect(repairSql).toContain(
      "if current_status is distinct from 'published' then return; end if",
    );
    expect(repairSql).not.toContain(
      "if current_status <> 'published' then return; end if",
    );
  });

  it("still rejects incomplete localization sets for an existing published brand", () => {
    expect(repairSql).toContain(
      "(select count(*) from public.brand_localizations where brand_id = target_id) <> 2",
    );
    expect(repairSql).toContain("enum_range(null::public.content_locale)");
    expect(repairSql).toContain(
      "published brand requires complete ko and en localizations",
    );
  });

  it("preserves the narrow service-role execution boundary", () => {
    expect(repairSql).toContain(
      "revoke all on function public.assert_brand_publishable(uuid)",
    );
    expect(repairSql).toContain(
      "grant execute on function public.assert_brand_publishable(uuid) to service_role",
    );
    expect(repairSql).toContain("security definer");
    expect(repairSql).toContain("set search_path = ''");
  });
});
