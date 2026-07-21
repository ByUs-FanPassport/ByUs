import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721074000_g3_attendance_rate_limit.sql"), "utf8");

describe("G3 attendance verification rate-limit contract", () => {
  it("stores category-only attempts with no code-bearing column", () => {
    const table = sql.slice(sql.indexOf("create table public.attendance_verification_attempts"), sql.indexOf("create index attendance_verification_attempts"));
    expect(table).toContain("'invalid_format', 'invalid_code', 'rate_limited', 'success'");
    expect(table).not.toMatch(/\b(?:code|hash|input|email|wallet)\b/i);
    expect(sql).toContain("attendance verification attempt is append-only");
  });

  it("serializes state by the existing owner/live lock and enforces five-in-ten then fifteen-minute lockout", () => {
    expect(sql).toContain("'g3:attendance:target:' || p_app_user_id::text || ':' || p_live_slug");
    expect(sql).toContain("current_time >= rate_state.window_started_at + interval '10 minutes'");
    expect(sql).toContain("next_failed_count = 5 then current_time + interval '15 minutes'");
    expect(sql).toContain("failed_count between 0 and 5");
  });

  it("commits invalid categories through a result envelope and clears failure state only after atomic success", () => {
    expect(sql).toContain("return jsonb_build_object('errorCode', 'G3_ATTENDANCE_CODE_INVALID')");
    expect(sql).toContain("return jsonb_build_object('errorCode', 'G3_ATTENDANCE_RATE_LIMITED')");
    const successfulMutation = sql.indexOf("result := public.attend_owned_live_event(");
    const clearState = sql.indexOf("perform public.record_successful_live_attendance_attempt(");
    expect(clearState).toBeGreaterThan(successfulMutation);
    expect(sql).toContain("set failed_count = 0");
  });

  it("uses a bounded bcrypt work factor and keeps all new boundaries service-private", () => {
    expect(sql).toContain("fan_code_hash ~ '^\\$2[aby]\\$(1[0-4])\\$[./A-Za-z0-9]{53}$'");
    expect(sql).toContain("revoke all on public.attendance_verification_attempts");
    expect(sql).toContain("revoke all on public.attendance_rate_limits");
    expect(sql).toContain("revoke all on function public.attend_owned_live_event(uuid, text, uuid, text, uuid, text, text)\n  from service_role");
    expect(sql).toContain("grant execute on function public.attend_owned_live_event(");
  });

  it("documents current-resource replay while preserving stable business identities", () => {
    expect(sql).toContain("business IDs remain stable while mintStatus may advance");
    expect(sql).toContain("return public.attend_owned_live_event(");
  });
});
