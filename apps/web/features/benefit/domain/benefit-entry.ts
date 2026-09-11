import { z } from "zod";
import { entryPolicyAcknowledgmentSchema, raffleFulfillmentPolicySchema } from "./raffle-fulfillment-policy";

export const enterBenefitRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    ticketAmount: z.number().int().positive(),
    policyAcknowledgment: entryPolicyAcknowledgmentSchema.optional(),
  })
  .strict();

export const benefitEntryResultSchema = z.object({
  entryId: z.string().uuid(),
  benefitId: z.string().uuid(),
  campaignId: z.string().uuid(),
  ticketAmount: z.number().int().positive(),
  benefitTicketTotal: z.number().int().positive(),
  perFanTicketLimit: z.number().int().positive().nullable(),
  remainingBenefitTickets: z.number().int().nonnegative().nullable(),
  ticketLedgerId: z.string().uuid(),
  resultingBalance: z.number().int().nonnegative(),
  replayed: z.boolean(),
});

export type BenefitEntryResult = z.infer<typeof benefitEntryResultSchema>;

export const benefitEntryStateSchema = z.object({
  fulfillmentPolicy: raffleFulfillmentPolicySchema.nullable().optional(),
  campaignId: z.string().uuid(),
  creatorTicketBalance: z.number().int().nonnegative(),
  enteredTickets: z.number().int().nonnegative(),
  perFanTicketLimit: z.number().int().positive().nullable(),
  remainingBenefitTickets: z.number().int().nonnegative().nullable(),
  entryOpensAt: z.string().datetime({ offset: true }),
  entryClosesAt: z.string().datetime({ offset: true }),
  canEnter: z.boolean(),
  entries: z.array(
    z.object({
      entryId: z.string().uuid(),
      ticketAmount: z.number().int().positive(),
      enteredAt: z.string().datetime({ offset: true }),
    }),
  ),
});
export type BenefitEntryState = z.infer<typeof benefitEntryStateSchema>;
