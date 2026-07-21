import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260721030000_g2_issuance_read.sql"),
  "utf8",
);

describe("G2 owner-only issuance read RPC", () => {
  it("is a single stable owner-scoped read with a fixed safe projection", () => {
    expect(sql).toContain("create function public.get_owned_passport_issuance(");
    expect(sql).toContain("stable");
    expect(sql).toContain("p.id = p_passport_id");
    expect(sql).toContain("p.app_user_id = p_app_user_id");
    expect(sql).toContain("s.app_user_id = p.app_user_id");
    expect(sql).toContain("s.celebrity_id = p.celebrity_id");
    expect(sql).toContain("a.activity_type = 'knowledge'");
    expect(sql).toContain("a.source_type = 'quiz_pass'");
    expect(sql).toContain("a.source_id = p.quiz_pass_id");
    expect(sql).toContain("order by s.issued_at, s.id");
    expect(sql).toContain("credential_count <> 1");
    expect(sql).toContain("'passport'");
    expect(sql).toContain("'celebrity'");
    expect(sql).toContain("'firstStamp'");
    expect(sql).toContain("'score'");
    expect(sql).not.toMatch(/\b(?:verified_email|privy_user_id|wallet|recipient|is_correct|blockchain_jobs|operation_key|href)\b/i);
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|public\.|from)\b/i);
  });

  it("is callable only by the service role", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.get_owned_passport_issuance(uuid, uuid, public.content_locale) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_owned_passport_issuance(uuid, uuid, public.content_locale) to service_role");
  });
});
