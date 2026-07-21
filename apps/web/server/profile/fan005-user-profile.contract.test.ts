import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721071500_fan005_user_profile.sql"), "utf8");

describe("FAN-005 user profile migration contract", () => {
  it("enforces one immutable profile and global normalized uniqueness", () => {
    expect(sql).toMatch(/app_user_id uuid primary key references public\.app_users/i);
    expect(sql).toMatch(/nickname_normalized_unique unique \(nickname_normalized\)/i);
    expect(sql).toMatch(/before update or delete on public\.user_profiles/i);
    expect(sql).toContain("FAN005_PROFILE_ALREADY_COMPLETED");
  });

  it("normalizes before validating the exact 2-16 visible character contract", () => {
    expect(sql).toMatch(/v_nickname := normalize\(btrim\(p_nickname\), NFKC\)/i);
    expect(sql).toMatch(/length\(v_nickname\) not between 2 and 16/i);
    expect(sql).toMatch(/\^\[A-Za-z0-9가-힣\]\+\$/);
  });

  it("uses a versioned prohibited catalog and differentiated stable errors", () => {
    expect(sql).toContain("fan-nickname-v1");
    expect(sql).toContain("FAN005_NICKNAME_PROHIBITED");
    expect(sql).toContain("FAN005_NICKNAME_TAKEN");
    expect(sql).toContain("FAN005_INVALID_NICKNAME");
  });

  it("keeps tables private and exposes only owner RPCs to service role", () => {
    expect(sql).toMatch(/revoke all on public\.user_profiles from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_owned_user_profile\(uuid\) to service_role/i);
    expect(sql).toMatch(/grant execute on function public\.set_owned_user_nickname\(uuid, text\) to service_role/i);
  });
});
