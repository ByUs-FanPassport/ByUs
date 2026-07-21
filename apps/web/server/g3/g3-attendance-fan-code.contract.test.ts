import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721073000_g3_attendance_fan_code.sql"), "utf8");

function definition(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("G3 Fan Code attendance database contract", () => {
  const attend = definition("attend_owned_live_event(");

  it("stores completed attendance only once per owner/live and never stores code material", () => {
    expect(sql).toContain("unique (app_user_id, live_event_id)");
    const table = sql.slice(sql.indexOf("create table public.live_attendances"), sql.indexOf("create index live_attendances_event"));
    expect(table).not.toMatch(/\b(?:code|hash|verifier|input)\b/i);
    expect(sql).toContain("live attendance is append-only");
  });

  it("uses a private bcrypt verifier and exposes one service-role-only mutation", () => {
    expect(attend).toContain("extensions.crypt(p_normalized_code, live_record.fan_code_hash)");
    expect(sql).toContain("fan_code_hash ~ '^\\$2[aby]\\$(1[0-4])\\$[./A-Za-z0-9]{53}$'");
    expect(attend).toContain("security definer");
    expect(attend).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on public.live_attendances from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function public.attend_owned_live_event(");
  });

  it("replays by key and owner/live before eligibility or code verification", () => {
    const keyReplay = attend.indexOf("where attendance.idempotency_key = p_idempotency_key");
    const targetReplay = attend.indexOf("where attendance.app_user_id = p_app_user_id");
    const userCheck = attend.indexOf("from public.app_users app_user");
    const codeCheck = attend.indexOf("extensions.crypt(p_normalized_code");
    expect(keyReplay).toBeGreaterThan(-1);
    expect(targetReplay).toBeGreaterThan(keyReplay);
    expect(userCheck).toBeGreaterThan(targetReplay);
    expect(codeCheck).toBeGreaterThan(userCheck);
    expect(attend).toContain("G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT");
  });

  it("serializes both idempotency-key and owner/live concurrency", () => {
    expect(attend.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(attend).toContain("g3:attendance:key:");
    expect(attend).toContain("g3:attendance:target:");
  });

  it("requires an issued same-celebrity Passport but no reservation or minted Passport", () => {
    const passport = attend.slice(attend.indexOf("from public.fan_passports passport"), attend.indexOf("-- Deliberately independent"));
    expect(passport).toContain("passport.business_status = 'issued'");
    expect(passport).not.toMatch(/mint_status|token_id|tx_hash/);
    expect(attend).not.toMatch(/from public\.live_reservations|insert into public\.live_reservations/);
  });

  it("does not gate on the current clock or live lifecycle status", () => {
    expect(attend).not.toMatch(/pg_catalog\.now\(\)|current_timestamp|starts_at|ends_at|content_status|live_status_overrides/);
  });

  it("atomically creates one attendance, activity, +3 ledger, Stamp, and job", () => {
    expect(attend.match(/insert into public\.live_attendances/g)).toHaveLength(1);
    expect(attend.match(/insert into public\.fan_activities/g)).toHaveLength(1);
    expect(attend.match(/insert into public\.fan_score_ledger/g)).toHaveLength(1);
    expect(attend.match(/insert into public\.stamps/g)).toHaveLength(1);
    expect(attend.match(/insert into public\.blockchain_jobs/g)).toHaveLength(1);
    expect(attend).toContain("'attendance', 'live_attendance', v_attendance_id");
    expect(attend).toContain("live_record.celebrity_id, 3");
    expect(attend).toContain("'stampType', 'Attendance'");
  });
});
