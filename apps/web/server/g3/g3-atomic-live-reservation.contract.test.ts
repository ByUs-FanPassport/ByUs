import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721060000_g3_atomic_live_reservation.sql",
  ),
  "utf8",
);

function definition(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("G3 atomic live reservation database contract", () => {
  const reserve = definition("reserve_owned_live_event(");

  it("exposes one service-role-only SECURITY DEFINER mutation boundary", () => {
    expect(reserve).toContain("security definer");
    expect(reserve).toContain("set search_path = ''");
    expect(sql).toContain(
      "grant execute on function public.reserve_owned_live_event(\n  uuid, uuid, uuid, uuid, text, text\n) to service_role",
    );
    expect(sql).not.toMatch(/grant execute[\s\S]*\b(?:anon|authenticated)\b/i);
    expect(sql).toContain("revoke insert on public.live_reservations from service_role");
  });

  it("replays a completed owner result before user, live, status, or time eligibility", () => {
    const keyReplay = reserve.indexOf("where reservation.idempotency_key = p_idempotency_key");
    const targetReplay = reserve.indexOf("where reservation.app_user_id = p_app_user_id");
    const userEligibility = reserve.indexOf("from public.app_users app_user");
    const liveEligibility = reserve.indexOf("from public.live_events live");
    expect(keyReplay).toBeGreaterThan(-1);
    expect(targetReplay).toBeGreaterThan(keyReplay);
    expect(userEligibility).toBeGreaterThan(targetReplay);
    expect(liveEligibility).toBeGreaterThan(userEligibility);
    expect(reserve).toContain("G3_IDEMPOTENCY_KEY_CONFLICT");
    expect(reserve).toContain("G3_RESERVATION_INTEGRITY_ERROR");
  });

  it("serializes both key reuse and owner/event concurrency", () => {
    expect(reserve.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(reserve).toContain("g3:reservation:key:");
    expect(reserve).toContain("g3:reservation:target:");
    expect(reserve).toContain("for update;");
  });

  it("uses the confirmed half-open reservation interval", () => {
    expect(reserve).toContain("pg_catalog.now() < live_record.reservation_opens_at");
    expect(reserve).toContain("pg_catalog.now() >= live_record.reservation_closes_at");
  });

  it("requires a published effectively scheduled live and honors an active override", () => {
    expect(reserve).toContain("from public.live_status_overrides override");
    expect(reserve).toContain("override.effective_from <= pg_catalog.now()");
    expect(reserve).toContain(
      "override.effective_until is null or pg_catalog.now() < override.effective_until",
    );
    expect(reserve).toContain("effective_status := coalesce(effective_status, live_record.content_status)");
    expect(reserve).toContain("live_record.publication_status <> 'published'");
    expect(reserve).toContain("effective_status <> 'scheduled'");
  });

  it("accepts an issued DB Passport without requiring a minted token", () => {
    const passportSection = reserve.slice(
      reserve.indexOf("from public.fan_passports passport"),
      reserve.indexOf("from public.user_wallets wallet"),
    );
    expect(passportSection).toContain("passport.business_status = 'issued'");
    expect(passportSection).not.toMatch(/mint_status|tx_hash|token_id/);
  });

  it("requires the user's Privy embedded wallet", () => {
    expect(reserve).toContain("wallet.chain_id = 91342");
    expect(reserve).toContain("wallet.provider = 'privy'");
    expect(reserve).toContain("wallet.wallet_type = 'embedded'");
    expect(reserve).toContain("G3_WALLET_NOT_READY");
  });

  it("atomically creates exactly one reservation activity, +1 ledger, Stamp, and job", () => {
    expect(reserve.match(/insert into public\.live_reservations/g)).toHaveLength(1);
    expect(reserve.match(/insert into public\.fan_activities/g)).toHaveLength(1);
    expect(reserve.match(/insert into public\.fan_score_ledger/g)).toHaveLength(1);
    expect(reserve.match(/insert into public\.stamps/g)).toHaveLength(1);
    expect(reserve.match(/insert into public\.blockchain_jobs/g)).toHaveLength(1);
    expect(reserve).toContain("'reservation', 'live_reservation', v_reservation_id");
    expect(reserve).toContain("v_activity_id, p_app_user_id, live_record.celebrity_id, 1");
    expect(reserve).toContain("'stampType', 'Reservation'");
    expect(reserve).toContain("'byus:stamp:v1:' || p_stamp_id::text");
  });

  it("does not implement cancellation or override transition policy", () => {
    expect(sql).not.toMatch(/cancel[_ ]reservation|delete from public\.live_reservations/i);
    expect(sql).not.toMatch(/insert into public\.live_status_overrides|update public\.live_status_overrides/i);
  });
});
