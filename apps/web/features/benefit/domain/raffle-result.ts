import { z } from "zod";
import { fulfillmentMethodSchema, fulfillmentStatusSchema } from "./fulfillment";
import { raffleFulfillmentPolicySchema } from "./raffle-fulfillment-policy";

/** A result is projected by the server only after checking ownership and publication. */
export const ownedRaffleResultSchema = z.object({
  benefitId: z.string().uuid(),
  campaignId: z.string().uuid(),
  title: z.string().min(1),
  benefitHref: z.string().regex(/^\/benefits\/[0-9a-f-]{36}$/),
  state: z.enum(["not_entered", "pending", "won", "not_won", "cancelled"]),
  enteredTickets: z.number().int().nonnegative(),
  entryClosesAt: z.string().datetime({ offset: true }).nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  winnerId: z.string().uuid().nullable(),
  method: fulfillmentMethodSchema,
  fulfillmentStatus: fulfillmentStatusSchema.nullable(),
  claimDisposition: z.enum(["active", "unclaimed"]),
  recipientDeadlineAt: z.string().datetime({ offset: true }).nullable(),
  recipientSubmitted: z.boolean(),
  recipientEditable: z.boolean(),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  policy: raffleFulfillmentPolicySchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.state === "won") {
    if (!value.publishedAt || !value.winnerId || !value.fulfillmentStatus) {
      context.addIssue({ code: "custom", message: "Winning result requires publication and fulfillment" });
    }
  } else if (value.winnerId || value.fulfillmentStatus || value.recipientSubmitted || value.recipientEditable || value.carrier || value.trackingNumber) {
    context.addIssue({ code: "custom", message: "Only winning results expose fulfillment" });
  }
  if (value.state === "not_won" && !value.publishedAt) {
    context.addIssue({ code: "custom", message: "Non-winning result requires publication" });
  }
});
export type OwnedRaffleResult = z.infer<typeof ownedRaffleResultSchema>;
export const ownedRaffleListSchema = z.object({
  items: z.array(ownedRaffleResultSchema),
  nextCursor: z.string().nullable(),
}).strict();
export type OwnedRaffleList = z.infer<typeof ownedRaffleListSchema>;

export const ownedRecipientDetailsSchema = z.object({
  winnerId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  editable: z.boolean(),
  deadlineAt: z.string().datetime({ offset: true }).nullable(),
  claimDisposition: z.enum(["active", "unclaimed"]),
  policy: raffleFulfillmentPolicySchema.nullable(),
  recipient: z.object({
    name: z.string(), phone: z.string(), phoneCountry: z.string().nullable(),
    postalCode: z.string().nullable(), address1: z.string().nullable(),
    address2: z.string().nullable(), shippingCountry: z.string().nullable(),
  }).strict().nullable(),
}).strict();
export type OwnedRecipientDetails = z.infer<typeof ownedRecipientDetailsSchema>;
