import { z } from "zod";

const localizedText = z.object({ ko: z.string(), en: z.string() }).strict();

export const raffleFulfillmentPolicySchema = z.object({
  version: z.string().min(1).max(100),
  method: z.enum(["digital", "physical_shipping", "on_site_pickup"]),
  shippingCountry: z.literal("KR").nullable(),
  requiresShippingAcknowledgment: z.boolean(),
  recipientWindowDays: z.literal(7),
  pickupEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  pickupVenue: localizedText,
  pickupInstructions: localizedText,
}).strict();

export type RaffleFulfillmentPolicy = z.infer<typeof raffleFulfillmentPolicySchema>;

export const entryPolicyAcknowledgmentSchema = z.object({
  policyVersion: z.string().min(1).max(100),
  canReceiveInKorea: z.boolean(),
}).strict();
export type EntryPolicyAcknowledgment = z.infer<typeof entryPolicyAcknowledgmentSchema>;

export function isRecipientOverdue(deadlineAt: string | null, submitted: boolean, now: Date): boolean {
  return !submitted && deadlineAt !== null && now.getTime() >= new Date(deadlineAt).getTime();
}
