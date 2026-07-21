import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721114500_fan020_nickname_rename.sql",
  ),
  "utf8",
);

describe("FAN-020 / AUTH-006 database contract", () => {
  it("allows only an owner-scoped profile rename through the service boundary", () => {
    expect(sql).toMatch(
      /create or replace function public\.rename_owned_user_nickname/i,
    );
    expect(sql).toMatch(
      /where u\.id = p_app_user_id and u\.status = 'active'/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.rename_owned_user_nickname\(uuid, text\) from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.rename_owned_user_nickname\(uuid, text\) to service_role/i,
    );
  });

  it("keeps identity columns immutable and never mutates credentials or wallets", () => {
    expect(sql).toMatch(/new\.app_user_id <> old\.app_user_id/);
    expect(sql).toMatch(/new\.created_at <> old\.created_at/);
    expect(sql).not.toMatch(
      /update public\.(passports|stamps|user_wallets|credential_metadata)/i,
    );
  });
});
