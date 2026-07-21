import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260721054500_g4_passport_stamp_read_models.sql"),
  "utf8",
);

const rpcSignatures = [
  "public.get_owned_passport_collection(uuid, public.content_locale)",
  "public.get_owned_passport_detail(uuid, uuid, public.content_locale)",
  "public.get_owned_stamp_detail(uuid, uuid, public.content_locale)",
];

describe("G4 owner-scoped Passport and Stamp read models", () => {
  it("defines collection, Passport detail, and Stamp detail as empty-result reads", () => {
    expect(sql).toContain("create function public.get_owned_passport_collection(");
    expect(sql).toContain("create function public.get_owned_passport_detail(");
    expect(sql).toContain("create function public.get_owned_stamp_detail(");
    expect(sql.match(/returns setof jsonb/g)).toHaveLength(3);
    expect(sql.match(/\bstable\b/g)).toHaveLength(3);
    expect(sql).not.toMatch(/raise exception|return null/i);
  });

  it("uses only canonical owner joins and an explicit null nickname placeholder", () => {
    expect(sql).toContain("passport.app_user_id = p_app_user_id");
    expect(sql).toContain("stamp.app_user_id = p_app_user_id");
    expect(sql).toContain("'owner', jsonb_build_object('nickname', null)");
    expect(sql).toContain("passport.app_user_id = stamp.app_user_id");
    expect(sql).toContain("activity.app_user_id = stamp.app_user_id");
  });

  it("projects exact score levels and all four canonical Stamp counts", () => {
    expect(sql).toContain("when score.total_points >= 35 then 'Diamond'");
    expect(sql).toContain("when score.total_points >= 20 then 'Platinum'");
    expect(sql).toContain("when score.total_points >= 10 then 'Gold'");
    expect(sql).toContain("when score.total_points >= 5 then 'Silver'");
    expect(sql).toContain("else 'Bronze'");
    for (const type of ["knowledge", "reservation", "attendance", "survey"]) {
      expect(sql).toContain(`filter (where stamp.stamp_type = '${type}')`);
      expect(sql).toContain(`'${type}', stamp_counts.${type}_count`);
    }
  });

  it("keeps the activity timeline deterministic and exposes only raw mint facts", () => {
    expect(sql).toContain("order by activity.occurred_at desc, activity.id desc");
    expect(sql).toContain("order by stamp.issued_at desc, stamp.id desc");
    expect(sql).toContain("'status', passport.mint_status");
    expect(sql).toContain("'status', stamp.mint_status");
    expect(sql).toContain("'txHash', passport.tx_hash");
    expect(sql).toContain("'txHash', stamp.tx_hash");
    expect(sql).toContain("'tokenId', passport.token_id::text");
    expect(sql).toContain("'tokenId', stamp.token_id::text");
    expect(sql).not.toMatch(/explorer|href|blockchain_jobs|operation_key|payload/i);
  });

  it("does not expose private identity or wallet data", () => {
    expect(sql).not.toMatch(/verified_email|privy_user_id|user_wallets|wallet|recipient/i);
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|public\.|from)\b/i);
  });

  it("allows execution only through the service role", () => {
    expect(sql.match(/security definer/g)).toHaveLength(3);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
    for (const signature of rpcSignatures) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });
});
