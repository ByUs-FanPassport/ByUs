import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260902024000_phase2_attendance_code_reward.sql"), "utf8");

describe("Phase 2 attendance code and reward contract", () => {
  it("flushes deferred LIVE triggers before hardening backfilled columns", () => {
    expect(sql.indexOf("set constraints all immediate")).toBeGreaterThan(sql.indexOf("update public.live_events"));
    expect(sql.indexOf("set constraints all immediate")).toBeLessThan(sql.indexOf("alter column attendance_valid_from set not null"));
  });

  it("backfills archived LIVE rows without leaving lifecycle protection disabled", () => {
    const disable = sql.indexOf("disable trigger live_events_enforce_lifecycle");
    const backfill = sql.indexOf("update public.live_events");
    const enable = sql.indexOf("enable trigger live_events_enforce_lifecycle");

    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(enable);
  });
  it("generates six unbiased uppercase alphanumeric characters and never audits plaintext", () => {
    expect(sql).toContain("while length(result) < 6");
    expect(sql).toContain("if sample < 252");
    expect(sql).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(sql).toContain("extensions.crypt(generated_code,extensions.gen_salt('bf',12))");
    expect(sql).not.toMatch(/before_after_summary[^;]+generated_code/s);
  });

  it("enforces the configured window before insertion and rewards Ticket +2 atomically", () => {
    expect(sql).toContain("create trigger live_attendances_window before insert");
    expect(sql).toContain("G3_ATTENDANCE_NOT_OPEN");
    expect(sql).toContain("G3_ATTENDANCE_ENDED");
    expect(sql).toContain("create trigger live_attendances_reward_ticket after insert");
    expect(sql).toContain("'credit',2");
    expect(sql).toContain("'live_attendance',new.id,new.id");
  });
});
