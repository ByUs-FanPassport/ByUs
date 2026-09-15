import { z } from "zod";

export const ticketActionKeySchema = z.enum([
  "verification", "reaction", "comment", "checkin",
  "membership_instagram", "membership_tiktok", "membership_youtube", "share",
]);

const safeInteger = z.number().int().safe();
const positiveSafeInteger = safeInteger.positive();

export const fanTicketActionSchema = z.object({
  key: ticketActionKeySchema,
  amount: z.literal(1),
  status: z.enum(["available", "pending", "awarded", "processing"]),
  href: z.string().startsWith("/").refine((value) => !value.startsWith("//")),
}).strict();

export const fanTicketHistoryItemSchema = z.object({
  id: z.uuid(),
  sequence: positiveSafeInteger,
  sourceType: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(160),
  amount: safeInteger,
  createdAt: z.iso.datetime({ offset: true }),
  occurredAt: z.iso.datetime({ offset: true }).nullable(),
  backfill: z.boolean(),
  balance: safeInteger.nonnegative(),
}).strict();

export const fanTicketActivitySchema = z.object({
  enabled: z.boolean(),
  creator: z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(1).max(120) }).strict(),
  balance: safeInteger.nonnegative(),
  today: z.iso.date(),
  actions: z.array(fanTicketActionSchema).max(8),
  history: z.array(fanTicketHistoryItemSchema).max(20),
  nextBefore: z.string().regex(/^[1-9]\d*$/).nullable(),
}).strict();

export type FanTicketActivity = z.infer<typeof fanTicketActivitySchema>;
export type FanTicketAction = z.infer<typeof fanTicketActionSchema>;

export function parseFanTicketActivity(value: unknown): FanTicketActivity {
  return fanTicketActivitySchema.parse(value);
}

export const FAN_TICKET_CREATOR_SLUGS = new Set(["elina", "changha", "yuna"]);
