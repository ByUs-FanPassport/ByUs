import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { BenefitRepository } from "./benefit-repository";
import { BenefitRepositoryError } from "./benefit-repository";
import {
  createGetBenefitHandler,
  createGetBenefitsHandler,
  createPostBenefitClaimHandler,
  createPostBenefitApplicationHandler,
  createGetOwnedBenefitApplicationHandler,
  type BenefitRouteDependencies,
} from "./benefit-route";

const benefitId = "11111111-1111-4111-8111-111111111111";
const benefit = {
  id: benefitId,
  slug: "reward",
  title: "Reward",
  summary: "Summary",
  eligibilityLabel: "Silver",
  deliveryLabel: "Code",
  deliveryType: "unique_code" as const,
  allocationMode: "direct_claim" as const,
  applicationStatus: null,
  claimOpensAt: "2026-07-21T00:00:00.000Z",
  claimClosesAt: "2026-07-22T00:00:00.000Z",
  minimumScore: 5,
  minimumLevel: "Silver" as const,
  requiredStampType: "knowledge" as const,
  requiredActivityType: "knowledge" as const,
  state: "eligible" as const,
};
function dependencies(
  repository: Partial<BenefitRepository> = {},
): BenefitRouteDependencies {
  return {
    repository: {
      list: vi.fn(async () => ({ benefits: [benefit] })),
      find: vi.fn(async () => benefit),
      claim: vi.fn(async () => ({
        claimId: "22222222-2222-4222-8222-222222222222",
        benefitId,
        deliveryType: "unique_code" as const,
        deliveryValue: "OWNER-ONLY",
        claimedAt: "2026-07-21T12:00:00.000Z",
        replayed: false,
      })),
      apply: vi.fn(async () => ({
        applicationId: "33333333-3333-4333-8333-333333333333",
        status: "submitted" as const,
        replayed: false,
      })),
      application: vi.fn(async () => null),
      ...repository,
    },
    authorize: vi.fn(async () => ({ appUserId: "owner" })),
    now: () => new Date("2026-07-21T12:00:00Z"),
  };
}

describe("benefit routes", () => {
  it("serves KO/EN public catalog without secret delivery material", async () => {
    const response = await createGetBenefitsHandler(dependencies())(
      new Request("https://byus.test/api/benefits?celebrity=kara&locale=ko"),
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("OWNER-ONLY");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("vercel-cache-tag")).toBe(
      "byus-public-content",
    );
  });

  it("keeps malformed and missing details opaque", async () => {
    const handler = createGetBenefitHandler(
      dependencies({ find: vi.fn(async () => null) }),
    );
    expect(
      (
        await handler(new Request("https://byus.test/api/benefits/x"), {
          benefitId: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await handler(new Request("https://byus.test/api/benefits/1"), {
          benefitId,
        })
      ).status,
    ).toBe(404);
  });

  it("accepts only a UUID idempotency key and uses canonical authenticated owner", async () => {
    const deps = dependencies();
    const response = await createPostBenefitClaimHandler(deps)(
      new Request(`https://byus.test/api/benefits/${benefitId}/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
        }),
      }),
      { benefitId },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deliveryValue: "OWNER-ONLY",
    });
    expect(deps.repository.claim).toHaveBeenCalledWith(
      expect.objectContaining({ appUserId: "owner" }),
    );
    const invalid = await createPostBenefitClaimHandler(deps)(
      new Request(`https://byus.test/api/benefits/${benefitId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: benefitId,
          appUserId: "attacker",
        }),
      }),
      { benefitId },
    );
    expect(invalid.status).toBe(400);
  });

  it("requires auth to claim and maps atomic RPC failures", async () => {
    const unauth = dependencies();
    unauth.authorize = vi.fn(async () => {
      throw new AuthError(
        "AUTHENTICATION_REQUIRED",
        401,
        "Authentication required",
      );
    });
    const request = () =>
      new Request(`https://byus.test/api/benefits/${benefitId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: benefitId }),
      });
    expect(
      (await createPostBenefitClaimHandler(unauth)(request(), { benefitId }))
        .status,
    ).toBe(401);
    const soldOut = dependencies({
      claim: vi.fn(async () => {
        throw new BenefitRepositoryError("BENEFIT_SOLD_OUT");
      }),
    });
    expect(
      (await createPostBenefitClaimHandler(soldOut)(request(), { benefitId }))
        .status,
    ).toBe(409);
  });

  it("submits applications with the canonical owner and Idempotency-Key header", async () => {
    const deps = dependencies();
    const response = await createPostBenefitApplicationHandler(deps)(
      new Request(`https://byus.test/api/benefits/${benefitId}/applications`, {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "idempotency-key": "33333333-3333-4333-8333-333333333333",
        },
      }),
      { benefitId },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applicationId: "33333333-3333-4333-8333-333333333333",
      status: "submitted",
      replayed: false,
    });
    expect(deps.repository.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        appUserId: "owner",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }),
    );
    const invalid = await createPostBenefitApplicationHandler(deps)(
      new Request(`https://byus.test/api/benefits/${benefitId}/applications`, {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "idempotency-key": "not-a-uuid",
        },
      }),
      { benefitId },
    );
    expect(invalid.status).toBe(400);
  });
  it("returns only the canonical owner's selected fulfillment", async () => {
    const application = {
      applicationId: "33333333-3333-4333-8333-333333333333",
      benefitId,
      status: "selected" as const,
      submittedAt: "2026-07-21T00:00:00.000Z",
      claim: {
        claimId: "22222222-2222-4222-8222-222222222222",
        benefitId,
        deliveryType: "unique_code" as const,
        deliveryValue: "OWNER-ONLY",
        claimedAt: "2026-07-21T12:00:00.000Z",
      },
    };
    const deps = dependencies({ application: vi.fn(async () => application) });
    const response = await createGetOwnedBenefitApplicationHandler(deps)(
      new Request(`https://byus.test/api/benefits/${benefitId}/applications`, {
        headers: { authorization: "Bearer token" },
      }),
      { benefitId },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ application });
    expect(deps.repository.application).toHaveBeenCalledWith({
      benefitId,
      appUserId: "owner",
    });
    const other = dependencies({ application: vi.fn(async () => null) });
    expect(
      (
        await createGetOwnedBenefitApplicationHandler(other)(
          new Request(
            `https://byus.test/api/benefits/${benefitId}/applications`,
            { headers: { authorization: "Bearer other" } },
          ),
          { benefitId },
        )
      ).status,
    ).toBe(404);
  });
});
