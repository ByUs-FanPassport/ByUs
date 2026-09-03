import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260903030000_phase5_notification_channels.sql"), "utf8");

describe("Phase 5 notification connection schema", () => {
  it("separates account facts, channel eligibility, and raw destinations", () => {
    const account = sql.slice(sql.indexOf("create table public.fan_connected_accounts"), sql.indexOf("create table public.fan_notification_channels"));
    expect(account).not.toMatch(/destination|consent|token/i);
    expect(sql).toContain("create table public.fan_notification_channel_private");
    expect(sql).toContain("destination_fingerprint");
  });
  it("allows only service-owned commands and keeps consent history immutable", () => {
    expect(sql).toContain("revoke all on table public.fan_connected_accounts");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("revoke all on function public.get_owned_notification_connections(uuid) from public,anon,authenticated");
    expect(sql).toContain("fan_notification_consent_audits_reject_update_delete");
  });
  it("syncs verified Google facts and email without coupling consent to disconnect", () => {
    expect(sql).toContain("sync_owned_google_notification_channel");
    expect(sql).toContain("p_google_connected");
    expect(sql).toContain("set_owned_notification_channel_consent");
    expect(sql).not.toMatch(/delete from public\.fan_notification_(?:channels|consent_audits)/);
  });
});
