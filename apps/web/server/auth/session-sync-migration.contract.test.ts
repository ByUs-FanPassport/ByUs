import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721014500_sync_privy_identity.sql"), "utf8");
const fixSql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721015000_fix_sync_privy_identity_conflict.sql"), "utf8");

describe("sync_privy_identity migration contract", () => {
  it("is service-role only and rejects silent wallet replacement", () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/revoke all on function public\.sync_privy_identity[\s\S]*anon, authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]*service_role/i);
    expect(sql).toMatch(/wallet relink requires review/i);
    expect(sql).toMatch(/wallet already linked/i);
  });

  it("uses the named wallet constraint so output columns cannot make the conflict target ambiguous", () => {
    expect(fixSql).toMatch(/on conflict on constraint user_wallets_one_wallet_per_user_chain/i);
    expect(fixSql).not.toMatch(/on conflict\s*\(app_user_id/i);
  });
});
