import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createGetPlatformAnalyticsHandler } from "./platform-analytics-route";
const id="11111111-1111-4111-8111-111111111111";
const url="http://localhost/api/admin/analytics/platform?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&asOf=2026-09-02T00%3A00%3A00.000Z";
describe("platform analytics route",()=>{
  it("authorizes before returning a private response",async()=>{const read=vi.fn(async()=>({window:{}} as never));const handler=createGetPlatformAnalyticsHandler({authorize:async()=>({appUserId:id,allowlistId:id,email:"admin@example.invalid",role:"admin"}),repository:{read}});expect((await handler(new Request(url,{headers:{authorization:"Bearer token"}}))).status).toBe(200);expect(read).toHaveBeenCalledWith(expect.objectContaining({adminAppUserId:id}));});
  it("rejects unsafe windows and unauthenticated calls",async()=>{const handler=createGetPlatformAnalyticsHandler({authorize:async()=>{throw new AuthError("AUTHENTICATION_REQUIRED",401,"required")},repository:{read:vi.fn()}});expect((await handler(new Request(url))).status).toBe(401);expect((await handler(new Request(url.replace("2026-09-01","2026-09-03"),{headers:{authorization:"Bearer x"}}))).status).toBe(400);});
});

