import{readFileSync}from"node:fs";import{resolve}from"node:path";import{describe,expect,it}from"vitest";
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260903030200_phase5_live_reminder_revision.sql"),"utf8");
describe("revision-aware LIVE reminders",()=>{
 it("uses confirmation, 24h, and 10m only with schedule revision keys",()=>{expect(sql).toContain(":reserved");expect(sql).toContain("'24h'");expect(sql).toContain("'10m'");expect(sql).not.toMatch(/30m/);expect(sql).toContain("schedule_revision");});
 it("invalidates old pending deliveries and preserves sent history",()=>{expect(sql).toContain("SCHEDULE_SUPERSEDED");expect(sql).toContain("LIVE_CANCELLED");expect(sql).toContain("o.status in('pending','failed','processing')");expect(sql).not.toMatch(/delete from public\.(?:fan_notifications|notification_delivery)/);});
 it("converges inserts by owner and revision source key",()=>{expect(sql.match(/on conflict\(app_user_id,source_key\)do nothing/g)?.length).toBeGreaterThanOrEqual(3);});
});
