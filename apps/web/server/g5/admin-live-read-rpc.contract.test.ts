import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260903014500_admin_live_read_rpc_volatility_fix.sql",
  ),
  "utf8",
);

describe("Admin LIVE read RPC transaction mode", () => {
  it("keeps authorization row locks out of PostgREST read-only transactions", () => {
    expect(sql).toContain(
      "alter function public.get_admin_live_reward_settings(uuid,uuid,uuid) volatile",
    );
    expect(sql).toContain(
      "alter function public.get_admin_live_attendance_settings(uuid,uuid,uuid) volatile",
    );
  });
});
