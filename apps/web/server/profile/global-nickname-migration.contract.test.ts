import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260906120000_global_nickname_format.sql",
  ),
  "utf8",
);

describe("global nickname database migration contract", () => {
  it("uses deterministic root ICU casing and NFKC edge-space normalization", () => {
    expect(sql).toMatch(
      /create collation public\.nickname_unicode[\s\S]*provider = icu[\s\S]*locale = 'und'[\s\S]*deterministic = true/i,
    );
    expect(sql.match(/btrim\(normalize\(p_nickname, NFKC\)\)/g)).toHaveLength(2);
    expect(
      sql.match(/lower\(v_nickname collate public\.nickname_unicode\)/g),
    ).toHaveLength(2);
  });

  it("keeps a private, immutable storage-safety helper", () => {
    expect(sql).toMatch(
      /create or replace function public\.nickname_is_db_safe\(p_nickname text\)[\s\S]*language sql[\s\S]*immutable[\s\S]*strict/i,
    );
    expect(sql).toMatch(/char_length\(p_nickname\) between 1 and 512/i);
    expect(sql).toMatch(/octet_length\(p_nickname\) <= 2048/i);
    expect(sql).toMatch(
      /revoke all on function public\.nickname_is_db_safe\(text\)[\s\S]*from public, anon, authenticated, service_role/i,
    );
  });

  it("strips non-Unicode-alphanumeric separators before prohibited matching", () => {
    expect(
      sql.match(/'\[\^\[:alnum:\]\]',\s*'',\s*'g'/g),
    ).toHaveLength(2);
    expect(
      sql.match(/strpos\(v_prohibited_candidate, c\.value_normalized\) > 0/g),
    ).toHaveLength(2);
  });

  it("narrows only creator catalog entries to exact matching", () => {
    expect(sql).toMatch(
      /value_normalized in \('kara', '카라', 'katseye', '캣츠아이'\)/,
    );
    expect(sql).toMatch(/set match_mode = 'exact'/i);
  });

  it("keeps mutation RPCs private and service-role scoped", () => {
    for (const rpc of ["set_owned_user_nickname", "rename_owned_user_nickname"]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${rpc}\\(uuid, text\\)[\\s\\S]*from public, anon, authenticated`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${rpc}\\(uuid, text\\)[\\s\\S]*to service_role`,
          "i",
        ),
      );
    }
  });

  it("does not rewrite existing fan-owned data", () => {
    const forwardDataMigration = sql.split(
      "create or replace function public.set_owned_user_nickname",
    )[0];

    expect(forwardDataMigration).not.toMatch(
      /update public\.(user_profiles|fan_passports|stamps|user_wallets|credential_metadata)/i,
    );
  });
});
