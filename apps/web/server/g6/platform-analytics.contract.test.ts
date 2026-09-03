import { readFileSync } from "node:fs";import{resolve}from"node:path";import{describe,expect,it}from"vitest";
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260903040100_phase6_platform_aggregates.sql"),"utf8");
describe("platform analytics SQL contract",()=>{it("guards one RPC and preserves canonical sources",()=>{expect(sql).toContain("read_admin_platform_analytics");expect(sql).toContain("assert_blockchain_job_admin_actor");for(const source of ["app_users","user_wallets","fan_passports","fan_reactions","live_reservations","live_attendances","blockchain_jobs"])expect(sql).toContain(source);expect(sql).toContain("WALLET_INVARIANT_FAILED");expect(sql).toContain("Asia/Seoul");});});

