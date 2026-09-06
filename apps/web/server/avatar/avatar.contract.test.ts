import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260906130000_app_user_avatars.sql"),
  "utf8",
);
const fixture = readFileSync(
  resolve(process.cwd(), "../../supabase/tests/avatar_contract.sql"),
  "utf8",
);

describe("private app user avatar SQL contract", () => {
  it("creates exactly twelve initial choices once and protects the initial value", () => {
    const ensure = sql.slice(sql.indexOf("create or replace function public.ensure_owned_avatar"));
    expect(ensure).toContain("floor(random() * 12)");
    expect(sql).toContain("app_user_avatars_initial_character_immutable");
    for (const family of ["star", "heart", "fairy", "ghost"]) {
      for (const color of ["cream", "pink", "lavender"]) {
        expect(sql).toContain(`'${family}-${color}'`);
      }
    }
    expect(fixture).toContain("initial character changed across ensure calls");
  });

  it("keeps the table private and exposes service-role RPCs with revision CAS", () => {
    expect(sql).toContain("revoke all on table public.app_user_avatars from public, anon, authenticated, service_role");
    expect(sql).toMatch(/where app_user_id = p_app_user_id and revision = p_expected_revision/g);
    expect(sql).toContain("AVATAR_STALE_REVISION");
    expect(sql).toContain("grant execute on function public.ensure_owned_avatar(uuid) to service_role");
    expect(fixture).toContain("stale CAS unexpectedly succeeded");
    expect(sql).toContain("AVATAR_GOOGLE_IMPORT_NOT_DEFAULT");
    expect(fixture).toContain("google import unexpectedly restored a removed avatar");
    expect(sql).toContain("position(p_app_user_id::text || '/' in p_object_path) <> 1");
  });

  it("uses a private WebP-only bucket and never grants browser table writes", () => {
    expect(sql).toContain("values ('fan-avatars', 'fan-avatars', false, 4194304, array['image/webp'])");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all).*app_user_avatars.*\b(anon|authenticated)\b/i);
    expect(sql).not.toContain("create policy \"Public can read fan avatars\"");
  });
});
