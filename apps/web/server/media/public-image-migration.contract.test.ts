import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260911034700_public_image_assets_and_roles.sql"), "utf8");
const fixture = readFileSync(resolve(process.cwd(), "../../supabase/tests/public_image_roles.sql"), "utf8");

describe("public image asset and role migration", () => {
  it("keeps metadata and bindings private behind guarded service-role RPCs", () => {
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke all on public.public_image_assets from public, anon, authenticated, service_role");
    expect(sql).toContain("perform public.assert_active_admin(p_actor_app_user_id, p_actor_admin_allowlist_id, true)");
    expect(sql).toContain("grant execute on function public.set_admin_public_image_role");
  });

  it("serializes absent-row CAS and persists null tombstones with increasing revisions", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("if p_expected_revision <> 0 then raise exception 'image role revision conflict'");
    expect(sql).toContain("if v_before.revision <> p_expected_revision then raise exception 'image role revision conflict'");
    expect(sql).toContain("revision = revision + 1");
    expect(sql).toContain("asset_id is null and alt_ko is null and alt_en is null and frames = '{}'::jsonb");
    expect(fixture).toContain("stale absent-row CAS unexpectedly succeeded");
    expect(fixture).toContain("removal tombstone did not advance the revision");
  });

  it("allows public reads only through existing publication projections and blocks cover upscaling", () => {
    expect(sql).toContain("from public.published_celebrities");
    expect(sql).toContain("live.publication_status = 'published'");
    expect(sql).toContain("live.archived_at is null");
    expect(sql).not.toContain("from public.published_celebrity_live_summaries where slug = any(p_slugs)");
    expect(sql).toContain("v_asset.width < v_slot_width or v_asset.height < v_slot_height");
    expect(sql).toContain("approved current asset revision without upscaling");
    expect(fixture).toContain("cross-owner identifier unexpectedly succeeded");
    expect(fixture).toContain("null alt text unexpectedly succeeded");
    expect(fixture).toContain("null frame fit unexpectedly succeeded");
    expect(fixture).toContain("viewer image-role write unexpectedly succeeded");
    expect(fixture).toContain("ended published LIVE tombstone was not projected");
    expect(fixture).toContain("image role write changed LIVE schedule history");
  });
});
