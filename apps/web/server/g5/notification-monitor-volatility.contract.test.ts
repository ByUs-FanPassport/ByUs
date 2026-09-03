import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260903031200_phase5_notification_monitor_volatility_fix.sql",
  ),
  "utf8",
);

describe("notification monitor RPC transaction mode", () => {
  it("keeps the Admin authorization row lock out of PostgREST read-only transactions", () => {
    expect(sql).toContain("alter function public.get_admin_notification_deliveries(");
    expect(sql).toContain(") volatile;");
  });
});
