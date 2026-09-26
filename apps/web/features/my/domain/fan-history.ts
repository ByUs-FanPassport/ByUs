import { z } from "zod";

export const historyKindSchema = z.enum(["applications", "rewards", "collection"]);
export type HistoryKind = z.infer<typeof historyKindSchema>;
export const historyCursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.string().regex(/^(?:(?:stamp|collectible|community|passport|reaction):)?[0-9a-f-]{36}$/) }).strict();
export const historyRowSchema = z.object({
  id: historyCursorSchema.shape.id, title: z.string().min(1),
  status: z.enum(["submitted", "selected", "not_selected", "cancelled", "collected", "information_required", "ready", "shipping_preparing", "shipping_in_transit", "shipping_completed", "pickup_available", "pickup_completed", "digital_delivered"]),
  occurredAt: z.iso.datetime({ offset: true }),
  href: z.string().regex(/^\/(?:passports(?:\/[0-9a-f-]{36})?|benefits\/[0-9a-f-]{36}|my\/rewards\/[0-9a-f-]{36}\/recipient|live\/[a-z0-9-]+)$/),
}).strict();
export const historyPageSchema = z.object({ items: z.array(historyRowSchema).max(30), nextCursor: z.string().max(500).nullable() }).strict();
export type HistoryPage = z.infer<typeof historyPageSchema>;
