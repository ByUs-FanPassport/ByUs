import { describe, expect, it, vi } from "vitest";
import { createBanksyAdminHandlers, createBanksyPublicHandlers } from "./banksy-campaign";
import { banksyDestinations } from "@/features/analytics/domain/banksy-campaign";
import type { AdminSession } from "../admin/admin-session-gate";

vi.mock("server-only", () => ({}));

const id = "10000000-0000-4000-8000-000000000001";
const visit = "20000000-0000-4000-8000-000000000001";
function setup() {
  const repository = { link: vi.fn().mockResolvedValue({ id, active: true, locale: "ko" }), visit: vi.fn().mockResolvedValue(visit), outbound: vi.fn().mockResolvedValue(undefined) };
  return { repository, handlers: createBanksyPublicHandlers(repository) };
}
describe("Banksy public measurement", () => {
  it("lands on existing raffle catalog and avoids preview attribution", async () => {
    const { handlers } = setup();
    const response = await handlers.shared(new Request(`https://byus.kr/t/${id}`), id);
    expect(response.headers.get("location")).toBe(`/c/elina/raffles?locale=ko&campaign_link=${id}`);
    const head = await handlers.shared(new Request(`https://byus.kr/t/${id}`, { method: "HEAD" }), id);
    expect(head.headers.get("location")).not.toContain("campaign_link");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("preserves fixed Mirrorworld attribution only for active links", async () => {
    const { handlers, repository } = setup();
    repository.link.mockResolvedValue({ id, active: true, locale: "ko", channel: "mirrorworld" });
    const request = new Request(`https://byus.kr/t/${id}?utm_source=evil&url=https://evil.test`);
    expect((await handlers.shared(request, id)).headers.get("location")).toBe(`/c/elina/raffles?locale=ko&campaign_link=${id}&utm_source=mirrorworld.ai&utm_medium=referral&utm_campaign=banksy`);
    repository.link.mockResolvedValue({ id, active: false, locale: "ko", channel: "mirrorworld" });
    expect((await handlers.shared(request, id)).headers.get("location")).toBe("/c/elina/raffles?locale=ko");
  });
  it("inactive and unavailable links still lead to raffles without attribution", async () => {
    const { handlers, repository } = setup();
    repository.link.mockResolvedValueOnce({ id, active: false, locale: "ko" });
    expect((await handlers.shared(new Request("https://byus.kr"), id)).headers.get("location")).not.toContain("campaign_link");
    repository.link.mockRejectedValueOnce(new Error("offline"));
    expect((await handlers.shared(new Request("https://byus.kr"), id)).status).toBe(302);
  });
  it("blocks cross-origin posts and forged identity fields", async () => {
    const { handlers, repository } = setup();
    const make = (body: unknown, origin = "https://byus.kr") => new Request("https://byus.kr/api/campaigns/banksy/visit", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    const body = { sessionId: id, firstLinkId: null, linkId: null, sequence: 0 };
    expect((await handlers.visit(make(body, "https://evil.test"))).status).toBe(403);
    expect((await handlers.visit(make({ ...body, userId: id }))).status).toBe(400);
    expect(repository.visit).not.toHaveBeenCalled();
    expect(await (await handlers.visit(make(body))).json()).toEqual({ visitId: visit });
  });
  it.each<RequestInit>([{ method: "HEAD" }, { headers: { purpose: "prefetch" } }, { headers: { "user-agent": "facebookexternalhit" } }])("does not count preview %j", async (init) => {
    const { handlers, repository } = setup();
    expect((await handlers.outbound(new Request("https://byus.kr/o/banksy/exhibition?surface=raffle_list", init), "exhibition")).status).toBe(302);
    expect(repository.outbound).not.toHaveBeenCalled();
  });
  it("keeps destination and retry key fixed, without leaking referrer", async () => {
    const { handlers, repository } = setup();
    const request = new Request(`https://byus.kr/o/banksy/exhibition?surface=raffle_receipt&visit=${visit}&request=${id}&url=https://evil.test`, { headers: { referer: "https://facebook.com/" } });
    const response = await handlers.outbound(request, "exhibition");
    expect(repository.outbound).toHaveBeenCalledWith({ visitId: visit, requestId: id, destination: "exhibition", surface: "raffle_receipt" });
    expect(response.headers.get("location")).toBe(banksyDestinations.exhibition);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await handlers.outbound(request, "invalid")).status).toBe(404);
  });
  it("still redirects on measurement failure, with malformed attribution unlinked", async () => {
    const { handlers, repository } = setup();
    repository.outbound.mockRejectedValueOnce(new Error("offline"));
    const response = await handlers.outbound(new Request("https://byus.kr/o/banksy/goods?surface=raffle_list&visit=invalid"), "goods");
    expect(response.headers.get("location")).toBe(banksyDestinations.goods);
    expect(repository.outbound.mock.calls[0][0].visitId).toBeNull();
  });
});
describe("Banksy admin authorization", () => {
  it("allows viewer reports but rejects mutations", async () => {
    const repository = { read: vi.fn().mockResolvedValue({}), command: vi.fn() };
    const authorize = vi.fn().mockResolvedValue({ role: "viewer", appUserId: id, allowlistId: visit } as AdminSession);
    const handler = createBanksyAdminHandlers(repository, authorize);
    expect((await handler(new Request("https://byus.kr/api/admin/campaigns/banksy"))).status).toBe(200);
    expect((await handler(new Request("https://byus.kr/api/admin/campaigns/banksy", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(repository.command).not.toHaveBeenCalled();
  });
});
