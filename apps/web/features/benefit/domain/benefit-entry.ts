import { z } from "zod";

export const enterBenefitRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    ticketAmount: z.number().int().positive(),
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
