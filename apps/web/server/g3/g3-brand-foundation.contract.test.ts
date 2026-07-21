import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721034500_g3_brand_foundation.sql",
  ),
  "utf8",
);

describe("G3 brand foundation migration contract", () => {
  it("uses the shared CMS status and locale types", () => {
    expect(sql).toContain("status public.content_status not null default 'draft'");
    expect(sql).toContain("locale public.content_locale not null");
    expect(sql).toContain("primary key (brand_id, locale)");
    expect(sql).not.toMatch(/create type public\.(?:brand_status|brand_locale)/i);
  });

  it("keeps brand identity and URLs canonical", () => {
    expect(sql).toContain("id uuid primary key default extensions.gen_random_uuid()");
    expect(sql).toContain("slug text not null unique");
    expect(sql).toContain("brands_slug_canonical");
    expect(sql).toContain("brands_logo_url_safe");
    expect(sql).toContain("brands_logo_alt_complete");
    expect(sql).toContain("brands_website_url_canonical_https");
    expect(sql).toContain("website_url is null");
    expect(sql).toContain("website_url !~ '[@[:space:]]'");
    expect(sql).toContain("logo_url !~ '[@[:space:]]'");
  });

  it("requires exactly one complete ko and en localization before publication", () => {
    expect(sql).toContain(
      "(select count(*) from public.brand_localizations where brand_id = target_id) <> 2",
    );
    expect(sql).toContain("enum_range(null::public.content_locale)");
    expect(sql).toContain(
      "published brand requires complete ko and en localizations",
    );
    expect(sql).toContain("brand_localizations_name_complete");
    expect(sql).toContain("brand_localizations_description_complete");
    expect(sql).toContain("deferrable initially deferred");
  });

  it("revalidates both brands when a localization changes ownership", () => {
    expect(sql).toContain(
      "old.brand_id is distinct from new.brand_id",
    );
    expect(sql).toContain(
      "perform public.assert_brand_publishable(old.brand_id)",
    );
    expect(sql).toContain(
      "perform public.assert_brand_publishable(new.brand_id)",
    );
  });

  it("uses the shared publication timestamps and updated-at behavior", () => {
    expect(sql).toContain("brands_publication_timestamp");
    expect(sql).toContain("execute function public.prepare_content_publication()");
    expect(sql).toContain("execute function public.set_updated_at()");
    expect(sql).toContain(
      "on public.brands (slug) where status = 'published'",
    );
  });

  it.each(["brands", "brand_localizations"])(
    "keeps private table %s behind RLS with browser grants revoked",
    (table) => {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(
        `revoke all on public.${table} from public, anon, authenticated`,
      );
      expect(sql).toContain(
        `grant select, insert, update, delete on public.${table} to service_role`,
      );
    },
  );

  it("does not expose a premature public brand projection", () => {
    expect(sql).not.toMatch(/create\s+(?:or\s+replace\s+)?view/i);
    expect(sql).not.toMatch(/grant\s+select[^;]+to\s+(?:anon|authenticated)/i);
  });

  it("allows service-role validation while keeping browser execution revoked", () => {
    expect(sql).toContain(
      "grant execute on function public.assert_brand_publishable(uuid) to service_role",
    );
    expect(sql).toContain(
      "revoke all on function public.assert_brand_publishable(uuid)",
    );
  });

  it.each([
    "assert_brand_publishable(uuid)",
    "validate_brand_publication_trigger()",
    "validate_brand_localization_trigger()",
  ])("revokes browser execution of helper %s", (signature) => {
    expect(sql).toContain(
      `revoke all on function public.${signature}`,
    );
  });
});
