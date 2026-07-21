import { z } from "zod";

export const benefitLocaleSchema = z.enum(["ko", "en"]);
export type BenefitLocale = z.infer<typeof benefitLocaleSchema>;

export const benefitStateSchema = z.enum([
  "locked",
  "eligible",
  "claimed",
  "sold_out",
  "expired",
]);
export type BenefitState = z.infer<typeof benefitStateSchema>;

export const benefitDeliveryTypeSchema = z.enum([
  "shared_code",
  "unique_code",
  "external_url",
]);
export type BenefitDeliveryType = z.infer<typeof benefitDeliveryTypeSchema>;
export const benefitAllocationModeSchema = z.enum([
  "direct_claim",
  "application_selection",
]);
export const benefitApplicationStatusSchema = z.enum([
  "submitted",
  "selected",
  "not_selected",
]);
export type BenefitApplicationStatus = z.infer<
  typeof benefitApplicationStatusSchema
>;

export const benefitCatalogItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  eligibilityLabel: z.string().min(1),
  deliveryLabel: z.string().min(1),
  deliveryType: benefitDeliveryTypeSchema,
  allocationMode: benefitAllocationModeSchema,
  applicationStatus: benefitApplicationStatusSchema.nullable(),
  claimOpensAt: z.string().datetime({ offset: true }),
  claimClosesAt: z.string().datetime({ offset: true }),
  minimumScore: z.number().int().nonnegative(),
  minimumLevel: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]),
  requiredStampType: z
    .enum(["knowledge", "reservation", "attendance", "survey"])
    .nullable(),
  requiredActivityType: z
    .enum(["knowledge", "reservation", "attendance", "survey"])
    .nullable(),
  state: benefitStateSchema,
});
export type BenefitCatalogItem = z.infer<typeof benefitCatalogItemSchema>;

export const benefitListResponseSchema = z.object({
  benefits: z.array(benefitCatalogItemSchema),
});
export type BenefitListResponse = z.infer<typeof benefitListResponseSchema>;

export const claimBenefitRequestSchema = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();
export const benefitApplicationResponseSchema = z.object({
  applicationId: z.string().uuid(),
  status: benefitApplicationStatusSchema,
  replayed: z.boolean(),
});
export type BenefitApplicationResponse = z.infer<
  typeof benefitApplicationResponseSchema
>;
export const benefitOwnedApplicationResponseSchema = z.object({
  applicationId: z.string().uuid(),
  benefitId: z.string().uuid(),
  status: benefitApplicationStatusSchema,
  submittedAt: z.string().datetime({ offset: true }),
  claim: z
    .object({
      claimId: z.string().uuid(),
      benefitId: z.string().uuid(),
      deliveryType: benefitDeliveryTypeSchema,
      deliveryValue: z.string().min(1),
      claimedAt: z.string().datetime({ offset: true }),
    })
    .nullable(),
});
export type BenefitOwnedApplicationResponse = z.infer<
  typeof benefitOwnedApplicationResponseSchema
>;

export const benefitClaimResponseSchema = z.object({
  claimId: z.string().uuid(),
  benefitId: z.string().uuid(),
  deliveryType: benefitDeliveryTypeSchema,
  deliveryValue: z.string().min(1),
  claimedAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
});
export type BenefitClaimResponse = z.infer<typeof benefitClaimResponseSchema>;

const levelRank = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  Platinum: 4,
  Diamond: 5,
} as const;

export interface BenefitEligibilitySnapshot {
  authenticated: boolean;
  hasPassport: boolean;
  score: number;
  level: keyof typeof levelRank;
  stampTypes: ReadonlySet<string>;
  activityTypes: ReadonlySet<string>;
  claimedBenefitIds: ReadonlySet<string>;
  benefitApplicationStatuses?: ReadonlyMap<string, BenefitApplicationStatus>;
}

export interface BenefitAvailabilityInput {
  id: string;
  available: boolean;
  claimOpensAt: string;
  claimClosesAt: string;
  minimumScore: number;
  minimumLevel: keyof typeof levelRank;
  requiredStampType: string | null;
  requiredActivityType: string | null;
}

export function deriveBenefitState(
  benefit: BenefitAvailabilityInput,
  viewer: BenefitEligibilitySnapshot | null,
  now: Date,
): BenefitState {
  if (viewer?.claimedBenefitIds.has(benefit.id)) return "claimed";
  if (now.getTime() >= new Date(benefit.claimClosesAt).getTime())
    return "expired";
  if (
    now.getTime() >= new Date(benefit.claimOpensAt).getTime() &&
    !benefit.available
  ) {
    return "sold_out";
  }
  if (
    !viewer?.authenticated ||
    !viewer.hasPassport ||
    viewer.score < benefit.minimumScore ||
    levelRank[viewer.level] < levelRank[benefit.minimumLevel] ||
    (benefit.requiredStampType !== null &&
      !viewer.stampTypes.has(benefit.requiredStampType)) ||
    (benefit.requiredActivityType !== null &&
      !viewer.activityTypes.has(benefit.requiredActivityType))
  ) {
    return "locked";
  }
  if (now.getTime() < new Date(benefit.claimOpensAt).getTime()) return "locked";
  return "eligible";
}

export function parseBenefitLocale(value: string): BenefitLocale {
  return benefitLocaleSchema.parse(value);
}

export function parseSafeExternalHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid external benefit URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    throw new Error("Invalid external benefit URL");
  }
  return parsed.href;
}
