import { z } from "zod";
import { raffleFulfillmentPolicySchema } from "./raffle-fulfillment-policy";

export const raffleSchema = z.object({
  requiresFanVerification: z.boolean().optional(),
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
  fulfillmentPolicy: raffleFulfillmentPolicySchema.nullable().optional(),
  perFanTicketLimit: z.number().int().positive().nullable(),
});

export const raffleListSchema = z.object({ raffles: z.array(raffleSchema) });
export type RaffleList = z.infer<typeof raffleListSchema>;

export function raffleStatus(raffle: RaffleList["raffles"][number], now: number): RaffleList["raffles"][number]["status"] {
  if (raffle.status === "cancelled" || raffle.status === "closed") return raffle.status;
  if (raffle.entryClosesAt && now >= Date.parse(raffle.entryClosesAt)) return "closed";
  if (raffle.entryOpensAt && now < Date.parse(raffle.entryOpensAt)) return "preparing";
  return raffle.status;
}
