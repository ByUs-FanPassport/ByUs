import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721089000_g5_fan_operations.sql",
  ),
  "utf8",
);

function fn(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated ${name}`);
  return sql.slice(start, end + 4);
}

describe("G5 ADM-010 Fan Operations contract", () => {
  it("adds immutable score adjustments without making the canonical score table mutable", () => {
    expect(sql).toContain("create table public.fan_score_adjustments");
    expect(sql).toContain("activity_id drop not null");
    expect(sql).toContain("adjustment_id uuid unique");
    expect(sql).toContain("num_nonnulls(activity_id, adjustment_id) = 1");
    expect(sql).toContain("score adjustment is append-only");
    expect(sql).not.toMatch(/update public\.fan_score_ledger\s+set/i);
  });

  it("keeps email search server-private and excludes PII and secrets from projections", () => {
    const list = fn("get_admin_fans(");
    const detail = fn("get_admin_fan_detail(");
    expect(list).toContain("user_record.verified_email = normalized_query");
    expect(list).not.toContain("'email'");
    for (const forbidden of [
      "verifiedEmail",
      "privyUserId",
      "codeValue",
      "secretValue",
      "freeText",
      "selectedOptionId",
    ]) {
      expect(list).not.toContain(`'${forbidden}'`);
      expect(detail).not.toContain(`'${forbidden}'`);
    }
    expect(detail).toContain("public.mask_admin_wallet_address");
  });

  it("returns Passport journeys with activity, effective ledger, stamps, claims, and applications", () => {
    const detail = fn("get_admin_fan_detail(");
    for (const field of [
      "'passports'",
      "'activities'",
      "'scoreLedger'",
      "'stamps'",
      "'benefitClaims'",
      "'benefitApplications'",
    ]) {
      expect(detail).toContain(field);
    }
    expect(detail).not.toMatch(
      /benefit_delivery_vault|benefit_unique_codes|survey_response_answers/i,
    );
  });

  it("restricts corrections to active Admin or Operator, active fan, and unarchived celebrity", () => {
    const adjust = fn("admin_adjust_fan_score(");
    expect(adjust).toContain("verified_role not in ('admin', 'operator')");
    expect(adjust).toContain("target_user.status <> 'active'");
    expect(adjust).toContain("celebrity.archived_at is null");
    expect(adjust).toContain("resulting_score < 0");
  });

  it("serializes and idempotently audits a bounded delta without audit reason or PII", () => {
    const adjust = fn("admin_adjust_fan_score(");
    expect(adjust.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(adjust).toContain(
      "where adjustment.idempotency_key = p_idempotency_key",
    );
    expect(adjust).toContain("G5_FAN_ADJUSTMENT_IDEMPOTENCY_CONFLICT");
    expect(adjust).toContain("p_points not between -100 and 100");
    expect(adjust).toContain("'reasonLength',length(normalized_reason)");
    expect(adjust).not.toContain("'reason', normalized_reason");
    expect(sql).toContain(
      "resulting_score integer not null check (resulting_score between 0 and 1000000)",
    );
    expect(adjust).toContain("existing.resulting_score");
    expect(adjust).toContain("fan.score_adjustment_replayed");
    expect(adjust).not.toContain(
      "select coalesce(sum(points),0)::integer into resulting_score",
    );
    expect(sql).toContain("sum(ledger.points::bigint)");
    expect(sql).toContain("fan score total must remain between 0 and 1000000");
    expect(sql).toContain("existing fan score total must remain between 0 and 1000000");
    expect(sql).toContain("group by ledger.app_user_id, ledger.celebrity_id");
  });

  it("forces RLS and exposes only service-role RPC execution", () => {
    expect(sql).toContain(
      "alter table public.fan_score_adjustments force row level security",
    );
    expect(sql).toContain(
      "revoke all on public.fan_score_adjustments from public, anon, authenticated, service_role",
    );
    expect(sql).toContain("grant execute on function public.get_admin_fans(");
    expect(sql).toContain(
      "grant execute on function public.get_admin_fan_detail(",
    );
    expect(sql).toContain(
      "grant execute on function public.admin_adjust_fan_score(",
    );
  });
});
