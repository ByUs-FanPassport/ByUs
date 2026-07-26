import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260726080301_unify_nickname_format_contract.sql",
  ),
  "utf8",
);

describe("nickname format database migration contract", () => {
  it("replaces the visible-character constraint with the UI contract", () => {
    expect(sql).toMatch(
      /drop constraint user_profiles_nickname_visible_characters/i,
    );
    expect(sql).toMatch(
      /check \(nickname ~ '\^\[A-Za-z0-9가-힣 _-\]\+\$'\)/,
    );
  });

  it.each([
    "set_owned_user_nickname",
    "rename_owned_user_nickname",
  ])("aligns %s with normalization, length, and separator rules", (rpc) => {
    expect(sql).toMatch(
      new RegExp(`create or replace function public\\.${rpc}`, "i"),
    );
    expect(sql).toMatch(
      /v_nickname := btrim\(normalize\(p_nickname, NFKC\)\)/i,
    );
    expect(sql).toMatch(/length\(v_nickname\) not between 2 and 16/i);
    expect(sql).toMatch(/v_nickname !~ '\^\[A-Za-z0-9가-힣 _-\]\+\$'/);
  });

  it("blocks prohibited-name separator evasion in both RPCs", () => {
    expect(
      sql.match(
        /v_prohibited_candidate := regexp_replace\(v_normalized, '\[ _-\]\+', '', 'g'\)/g,
      ),
    ).toHaveLength(2);
    expect(
      sql.match(
        /strpos\(v_prohibited_candidate, c\.value_normalized\) > 0/g,
      ),
    ).toHaveLength(2);
  });

  it("keeps both RPCs private and service-role scoped", () => {
    expect(sql).toMatch(
      /revoke all on function public\.set_owned_user_nickname\(uuid, text\)[\s\S]*from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.rename_owned_user_nickname\(uuid, text\)[\s\S]*from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.set_owned_user_nickname\(uuid, text\)[\s\S]*to service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.rename_owned_user_nickname\(uuid, text\)[\s\S]*to service_role/i,
    );
  });

  it("does not rewrite owned fan data", () => {
    expect(sql).not.toMatch(
      /update public\.(passports|stamps|user_wallets|credential_metadata)/i,
    );
  });
});
