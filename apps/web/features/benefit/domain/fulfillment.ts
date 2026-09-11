import { z } from "zod";
import { isSupportedCountry } from "libphonenumber-js";
import type { Country } from "react-phone-number-input";

import { normalizeRecipientPhone } from "./recipient-phone";

export const fulfillmentMethodSchema = z.enum([
  "digital",
  "physical_shipping",
  "on_site_pickup",
]);
export const fulfillmentStatusSchema = z.enum([
  "information_required",
  "ready",
  "shipping_preparing",
  "shipping_in_transit",
  "shipping_completed",
  "pickup_available",
  "pickup_completed",
  "digital_delivered",
]);
export type FulfillmentMethod = z.infer<typeof fulfillmentMethodSchema>;
export type FulfillmentStatus = z.infer<typeof fulfillmentStatusSchema>;

/** Must be released with the matching consent copy and active DB version. */
export const BENEFIT_RECIPIENT_CONSENT_VERSION = "2026-09-raffle-v2";

const next: Record<FulfillmentMethod, Partial<Record<FulfillmentStatus, FulfillmentStatus>>> = {
  digital: { ready: "digital_delivered" },
  physical_shipping: {
    information_required: "ready",
    ready: "shipping_preparing",
    shipping_preparing: "shipping_in_transit",
    shipping_in_transit: "shipping_completed",
  },
  on_site_pickup: {
    information_required: "ready",
    ready: "pickup_available",
    pickup_available: "pickup_completed",
  },
};

export function canTransitionFulfillment(
  method: FulfillmentMethod,
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return next[method][from] === to;
}

export const recipientInputSchema = z
  .object({
    consentVersion: z.string().trim().min(1).max(100),
    consented: z.literal(true),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(40),
    phoneCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
    shippingCountry: z.literal("KR").optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    postalCode: z.string().trim().max(20).optional(),
    address1: z.string().trim().max(300).optional(),
    address2: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const isV2 = input.phoneCountry !== undefined
      || input.shippingCountry !== undefined
      || input.expectedRevision !== undefined;
    if (!isV2) return;

    if (!input.phoneCountry) {
      context.addIssue({ code: "custom", path: ["phoneCountry"], message: "Phone country is required" });
    }
    if (input.expectedRevision === undefined) {
      context.addIssue({ code: "custom", path: ["expectedRevision"], message: "Expected revision is required" });
    }
    if (input.phoneCountry) {
      if (!isSupportedCountry(input.phoneCountry)) {
        context.addIssue({ code: "custom", path: ["phoneCountry"], message: "Phone country is not supported" });
      } else {
        try {
          const normalized = normalizeRecipientPhone(input.phoneCountry as Country, input.phone);
          if (normalized.e164 !== input.phone) {
            context.addIssue({ code: "custom", path: ["phone"], message: "Phone must use normalized E.164 format" });
          }
        } catch {
          context.addIssue({ code: "custom", path: ["phone"], message: "Phone must be a valid E.164 number for the selected country" });
        }
      }
    }

    const hasAddress = input.postalCode !== undefined
      || input.address1 !== undefined
      || input.address2 !== undefined;
    if (hasAddress && input.shippingCountry !== "KR") {
      context.addIssue({ code: "custom", path: ["shippingCountry"], message: "Shipping country is required" });
    }
    if (input.shippingCountry === "KR") {
      if (!/^\d{5}$/.test(input.postalCode ?? "")) {
        context.addIssue({ code: "custom", path: ["postalCode"], message: "Korean postal code must contain five digits" });
      }
      if (!input.address1?.trim()) {
        context.addIssue({ code: "custom", path: ["address1"], message: "Address is required" });
      }
    }
  });
export type RecipientInput = z.infer<typeof recipientInputSchema>;

export const recipientSaveResultSchema = z
  .object({
    winnerId: z.string().uuid(),
    method: fulfillmentMethodSchema.exclude(["digital"]),
    status: z.literal("ready"),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type RecipientSaveResult = z.infer<typeof recipientSaveResultSchema>;
