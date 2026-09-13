import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRecurringLiveHandlers, type RecurringLiveRouteDependencies } from "./recurring-live-route";
const id = "11111111-1111-4111-8111-111111111111";
const body = { revisionId: id, expectedCurrentRevisionId: null, resolution: { action: "approve_rule" } };
function deps(role: "viewer" | "operator" = "operator"): RecurringLiveRouteDependencies {
  return { authorize: vi.fn(async () => ({ role, appUserId: id, allowlistId: id, email: "ops@example.invalid" })), read: vi.fn(async () => ({ reviews: [] })), resolve: vi.fn(async () => ({ status: "approved" })), invalidatePublicContent: vi.fn() };
}
const request = (value = body) => new Request("https://byus.kr/api/admin/recurring-lives", { method: "POST", headers: { authorization: "Bearer opaque", "content-type": "application/json" }, body: JSON.stringify(value) });
describe("recurring review authority and conflict", () => {
  it("allows private viewer reads but never viewer mutations", async () => {
    const d=deps("viewer"); const h=createRecurringLiveHandlers(d);
    expect((await h.GET(request())).headers.get("cache-control")).toBe("private, no-store");
    expect((await h.POST(request())).status).toBe(403);expect(d.resolve).not.toHaveBeenCalled();
  });
  it("passes actor and CAS and invalidates only successful writes", async()=>{
    const d=deps();const h=createRecurringLiveHandlers(d);
    expect((await h.POST(request())).status).toBe(200);
    expect(d.resolve).toHaveBeenCalledWith({appUserId:id,allowlistId:id},body,expect.any(String));expect(d.invalidatePublicContent).toHaveBeenCalledOnce();
    vi.mocked(d.resolve).mockRejectedValue(new Error("stale revision mismatch"));
    expect((await h.POST(request())).status).toBe(409);expect(d.invalidatePublicContent).toHaveBeenCalledOnce();
  });
  it("rejects arbitrary rule payloads before mutation",async()=>{
    const d=deps(); const h=createRecurringLiveHandlers(d);
    expect((await h.POST(request({...body, resolution: {action:"approve_rule", sql:"delete"}} as typeof body))).status).toBe(400);
    expect(d.resolve).not.toHaveBeenCalled();
  });
});


it.each([
  {action:"link_existing",eventId:id},
  {action:"distinct_events"},
  {action:"cancel_occurrences",eventIds:[id],reason:"Official cancellation"},
])("forwards an allowlisted conflict resolution through authenticated CAS: $action",async(resolution)=>{
 const d=deps(); const response=await createRecurringLiveHandlers(d).POST(request({...body,resolution} as typeof body));
 expect(response.status).toBe(200);expect(d.resolve).toHaveBeenCalledWith({appUserId:id,allowlistId:id},expect.objectContaining({expectedCurrentRevisionId:null,resolution}),expect.any(String));
});
