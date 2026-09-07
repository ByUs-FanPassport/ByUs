import { z } from "zod";

export const raffleSchema = z.object({
  id: z.string().uuid(),
  benefitId: z.string().uuid().nullable(),
  title: z.string().min(1),
  summary: z.string().min(1),
  imageUrl: z.union([z.string().url(), z.string().regex(/^\/(?!\/)[^\s@]+$/)]).nullable(),
  winnerQuantity: z.number().int().positive(),
  status: z.enum(["preparing", "open", "closed", "cancelled"]),
  entryOpensAt: z.string().datetime({ offset: true }).nullable(),
  entryClosesAt: z.string().datetime({ offset: true }).nullable(),
  fulfillmentMethod: z.enum(["digital", "physical_shipping", "on_site_pickup"]),
  perFanTicketLimit: z.number().int().positive().nullable(),
});

export const raffleListSchema = z.object({ raffles: z.array(raffleSchema) });
export type RaffleList = z.infer<typeof raffleListSchema>;
