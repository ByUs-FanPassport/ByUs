import { z } from "zod";

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
    postalCode: z.string().trim().max(20).optional(),
    address1: z.string().trim().max(300).optional(),
    address2: z.string().trim().max(300).optional(),
  })
  .strict();
export type RecipientInput = z.infer<typeof recipientInputSchema>;
