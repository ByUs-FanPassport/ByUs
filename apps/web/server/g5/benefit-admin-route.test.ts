import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createGetBenefitAdminHandler,
  createPostBenefitAdminHandler,
  type BenefitAdminDependencies,
} from "./benefit-admin-route";
function deps(role: "admin" | "operator" | "viewer" = "admin") {
  return {
    authorize: vi
      .fn()
      .mockResolvedValue({
        appUserId: "11111111-1111-4111-8111-111111111111",
        allowlistId: "22222222-2222-4222-8222-222222222222",
        email: "ops@byus.test",
        role,
      }),
    repository: {
      read: vi.fn().mockResolvedValue({ benefits: [], celebrities: [] }),
      save: vi.fn().mockResolvedValue("33333333-3333-4333-8333-333333333333"),
      codes: vi.fn().mockResolvedValue({ addedCount: 2, duplicateCount: 1 }),
      clearCodes: vi.fn().mockResolvedValue({ removedCount: 2 }),
      state: vi.fn(),
      decide: vi.fn().mockResolvedValue({ status: "selected" }),
      use: vi.fn().mockResolvedValue({ usedAt: "2026-07-21T00:00:00Z" }),
    },
  } satisfies BenefitAdminDependencies;
}
const req = (body?: unknown) =>
  new Request("http://local/api/admin/benefits", {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      "x-correlation-id": "44444444-4444-4444-8444-444444444444",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
describe("benefit admin route", () => {
  it("returns only the repository projection", async () => {
    const d = deps();
    const r = await createGetBenefitAdminHandler(d)(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ benefits: [], celebrities: [] });
  });
  it("keeps viewers read-only", async () => {
    const d = deps("viewer");
    const r = await createPostBenefitAdminHandler(d)(
      req({
        action: "publish",
        id: "33333333-3333-4333-8333-333333333333",
        expectedRevision: 1,
      }),
    );
    expect(r.status).toBe(403);
    expect(d.repository.state).not.toHaveBeenCalled();
  });
  it("passes code inventory without echoing it", async () => {
    const d = deps();
    const r = await createPostBenefitAdminHandler(d)(
      req({
        action: "codes",
        id: "33333333-3333-4333-8333-333333333333",
        expectedRevision: 1,
        codes: ["SECRET-A", "SECRET-A", "SECRET-B"],
      }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ addedCount: 2, duplicateCount: 1 });
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
  it("requires UUID idempotency for selection", async () => {
    const d = deps();
    const r = await createPostBenefitAdminHandler(d)(
      req({
        action: "decide",
        applicationId: "33333333-3333-4333-8333-333333333333",
        selected: true,
        idempotencyKey: "bad",
      }),
    );
    expect(r.status).toBe(400);
  });
  it("requires application selection to keep a one-per-user limit", async () => {
    const d = deps();
    const r = await createPostBenefitAdminHandler(d)(
      req({
        action: "save",
        id: null,
        expectedRevision: null,
        slug: "x",
        celebrityId: "33333333-3333-4333-8333-333333333333",
        allocationMode: "application_selection",
        deliveryType: "text",
        claimOpensAt: "2026-07-21T00:00:00Z",
        claimClosesAt: "2026-07-22T00:00:00Z",
        stockLimit: null,
        perUserLimit: 2,
        minimumScore: 0,
        minimumLevel: "Bronze",
        requiredStampType: null,
        requiredActivityType: null,
        titleKo: "a",
        summaryKo: "a",
        eligibilityKo: "a",
        deliveryKo: "a",
        titleEn: "a",
        summaryEn: "a",
        eligibilityEn: "a",
        deliveryEn: "a",
        deliverySecret: "secret",
      }),
    );
    expect(r.status).toBe(400);
  });
});
