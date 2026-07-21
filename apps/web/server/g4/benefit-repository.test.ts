import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  DefaultBenefitRepository,
  BenefitRepositoryError,
  type BenefitDataSource,
} from "./benefit-repository";

const id = "11111111-1111-4111-8111-111111111111";
const raw = {
  id,
  slug: "kara-reward",
  title: "리워드",
  summary: "설명",
  eligibilityLabel: "Silver 이상",
  deliveryLabel: "코드",
  deliveryType: "unique_code",
  allocationMode: "direct_claim",
  claimOpensAt: "2026-07-21T00:00:00.000Z",
  claimClosesAt: "2026-07-22T00:00:00.000Z",
  minimumScore: 5,
  minimumLevel: "Silver",
  requiredStampType: "knowledge",
  requiredActivityType: "knowledge",
  available: true,
};
function source(overrides: Partial<BenefitDataSource> = {}): BenefitDataSource {
  return {
    getPublished: vi.fn(async () => [raw]),
    findCelebritySlug: vi.fn(async () => "kara"),
    getEligibility: vi.fn(async () => ({
      authenticated: true,
      hasPassport: true,
      score: 5,
      level: "Silver" as const,
      stampTypes: new Set(["knowledge"]),
      activityTypes: new Set(["knowledge"]),
      claimedBenefitIds: new Set<string>(),
      benefitApplicationStatuses: new Map(),
    })),
    claim: vi.fn(async () => ({
      claimId: "22222222-2222-4222-8222-222222222222",
      benefitId: id,
      deliveryType: "unique_code",
      deliveryValue: "SECRET",
      claimedAt: "2026-07-21T12:00:00.000Z",
      replayed: false,
    })),
    apply: vi.fn(async () => ({
      applicationId: "33333333-3333-4333-8333-333333333333",
      status: "submitted",
      replayed: false,
    })),
    application: vi.fn(async () => null),
    ...overrides,
  };
}

describe("benefit repository", () => {
  it("projects eligible catalog without delivery secrets", async () => {
    const repository = new DefaultBenefitRepository(source());
    const result = await repository.list({
      celebritySlug: "kara",
      locale: "ko",
      appUserId: "owner",
      now: new Date("2026-07-21T12:00:00Z"),
    });
    expect(result.benefits[0]?.state).toBe("eligible");
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("deliveryValue");
  });

  it("normalizes the database external_link enum at the public catalog boundary", async () => {
    const repository = new DefaultBenefitRepository(
      source({ getPublished: vi.fn(async () => [{ ...raw, deliveryType: "external_link" }]) }),
    );
    await expect(
      repository.list({
        celebritySlug: "kara",
        locale: "ko",
        appUserId: "owner",
        now: new Date("2026-07-21T12:00:00Z"),
      }),
    ).resolves.toMatchObject({ benefits: [{ deliveryType: "external_url" }] });
  });

  it("returns opaque null when benefit is absent or unpublished", async () => {
    const repository = new DefaultBenefitRepository(
      source({ findCelebritySlug: vi.fn(async () => null) }),
    );
    await expect(
      repository.find({
        benefitId: id,
        locale: "en",
        appUserId: null,
        now: new Date(),
      }),
    ).resolves.toBeNull();
  });

  it("returns delivery material only from claim and rejects unsafe external URLs", async () => {
    const safe = new DefaultBenefitRepository(
      source({
        claim: vi.fn(async () => ({
          claimId: "22222222-2222-4222-8222-222222222222",
          benefitId: id,
          deliveryType: "external_link",
          deliveryValue: "https://example.com/reward",
          claimedAt: "2026-07-21T12:00:00.000Z",
          replayed: true,
        })),
      }),
    );
    await expect(
      safe.claim({
        benefitId: id,
        appUserId: "owner",
        idempotencyKey: id,
        now: new Date(),
      }),
    ).resolves.toMatchObject({
      deliveryValue: "https://example.com/reward",
      replayed: true,
    });
    const unsafe = new DefaultBenefitRepository(
      source({
        claim: vi.fn(async () => ({
          claimId: "22222222-2222-4222-8222-222222222222",
          benefitId: id,
          deliveryType: "external_url",
          deliveryValue: "javascript:alert(1)",
          claimedAt: "2026-07-21T12:00:00.000Z",
          replayed: false,
        })),
      }),
    );
    await expect(
      unsafe.claim({
        benefitId: id,
        appUserId: "owner",
        idempotencyKey: id,
        now: new Date(),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BenefitRepositoryError>>({
        code: "BENEFIT_UNAVAILABLE",
      }),
    );
  });

  it("projects the authenticated fan application status and parses replay safely", async () => {
    const repository = new DefaultBenefitRepository(
      source({
        getEligibility: vi.fn(async () => ({
          authenticated: true,
          hasPassport: true,
          score: 5,
          level: "Silver" as const,
          stampTypes: new Set(["knowledge"]),
          activityTypes: new Set(["knowledge"]),
          claimedBenefitIds: new Set<string>(),
          benefitApplicationStatuses: new Map([[id, "submitted" as const]]),
        })),
      }),
    );
    const result = await repository.list({
      celebritySlug: "kara",
      locale: "ko",
      appUserId: "owner",
      now: new Date("2026-07-21T12:00:00Z"),
    });
    expect(result.benefits[0]?.applicationStatus).toBe("submitted");
    await expect(
      repository.apply({
        benefitId: id,
        appUserId: "owner",
        idempotencyKey: id,
        now: new Date(),
      }),
    ).resolves.toEqual({
      applicationId: "33333333-3333-4333-8333-333333333333",
      status: "submitted",
      replayed: false,
    });
  });
  it("normalizes and validates only the owner's selected external fulfillment", async () => {
    const repository = new DefaultBenefitRepository(
      source({
        application: vi.fn(async () => ({
          applicationId: "33333333-3333-4333-8333-333333333333",
          benefitId: id,
          status: "selected",
          submittedAt: "2026-07-21T00:00:00.000Z",
          claim: {
            claimId: "22222222-2222-4222-8222-222222222222",
            benefitId: id,
            deliveryType: "external_link",
            deliveryValue: "https://example.com/reward",
            claimedAt: "2026-07-21T12:00:00.000Z",
          },
        })),
      }),
    );
    await expect(
      repository.application({ benefitId: id, appUserId: "owner" }),
    ).resolves.toMatchObject({
      claim: {
        deliveryType: "external_url",
        deliveryValue: "https://example.com/reward",
      },
    });
    const unsafe = new DefaultBenefitRepository(
      source({
        application: vi.fn(async () => ({
          applicationId: "33333333-3333-4333-8333-333333333333",
          benefitId: id,
          status: "selected",
          submittedAt: "2026-07-21T00:00:00.000Z",
          claim: {
            claimId: "22222222-2222-4222-8222-222222222222",
            benefitId: id,
            deliveryType: "external_link",
            deliveryValue: "javascript:alert(1)",
            claimedAt: "2026-07-21T12:00:00.000Z",
          },
        })),
      }),
    );
    await expect(
      unsafe.application({ benefitId: id, appUserId: "owner" }),
    ).rejects.toEqual(expect.objectContaining({ code: "BENEFIT_UNAVAILABLE" }));
  });
});
