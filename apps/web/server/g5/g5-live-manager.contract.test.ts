import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721084500_g5_live_manager.sql"), "utf8");
describe("ADM-005 database contract", () => {
  it("hashes plaintext within the server command at bcrypt cost 12", () => {
    expect(sql).toContain("extensions.crypt(p_fan_code_plaintext, extensions.gen_salt('bf', 12))");
    const sqlPattern = sql.match(/'fanCodeConfigured', l\.fan_code_hash ~ '([^']+)'/)?.[1];
    expect(sqlPattern).toBeDefined();
    expect(new RegExp(sqlPattern!).test("$2a$12$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuu")).toBe(true);
    expect(sql).not.toMatch(/jsonb_build_object\([^;]*fan_code_plaintext/is);
  });
  it("never projects the fan code hash or plaintext", () => {
    const projection = sql.slice(sql.indexOf("create function public.get_admin_live_manager"), sql.indexOf("create function public.save_admin_live_draft"));
    expect(projection).not.toContain("fan_code_hash',"); expect(projection).not.toContain("fan_code_plaintext");
    expect(projection).toContain("'fanCodeConfigured'");
  });
  it("limits mutation commands to admin and operator and carries correlation IDs", () => {
    expect(sql).toContain("a.role in ('admin', 'operator')");
    expect(sql).toContain("p_correlation_id"); expect(sql).toContain("correlation_id");
  });
  it("uses the existing append-only override and archive policies", () => {
    expect(sql).toContain("insert into public.live_status_overrides");
    expect(sql).toContain("live_status_overrides_reject_archived");
    expect(sql).toContain("where l.id=new.live_event_id and l.archived_at is null for update");
    expect(sql).not.toContain("delete from public.live_events");
  });
  it("computes audit before-state without the newly inserted override", () => {
    expect(sql).toContain("o.id<>new.id");
    expect(sql).not.toContain("before_status := public.live_effective_status_at(new.live_event_id, new.effective_from)");
  });
  it("keeps the generic archive row result inside PostgreSQL", () => {
    expect(sql).toContain("create function public.archive_admin_live");
    expect(sql).toContain("perform public.archive_admin_content");
  });
});
