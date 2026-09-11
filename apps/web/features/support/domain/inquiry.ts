import { z } from "zod";

export const inquiryStatusSchema = z.enum(["open", "answered", "resolved"]);
export const inquirySchema = z.object({
  id: z.uuid(), subject: z.string().min(1).max(120), locale: z.enum(["ko", "en"]),
  status: inquiryStatusSchema, version: z.number().int().positive(), requesterName: z.string(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
}).strict();
export const messageSchema = z.object({
  id: z.uuid(), body: z.string().min(1).max(4000), sender: z.enum(["fan", "admin"]),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();
export const createInquirySchema = z.object({
  subject: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000),
  locale: z.enum(["ko", "en"]), idempotencyKey: z.uuid(),
}).strict();
export const postMessageSchema = createInquirySchema.pick({ body: true, idempotencyKey: true });
export const resolveInquirySchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const mutationSchema = z.object({ id: z.uuid(), replayed: z.boolean() }).strict();
export const listResultSchema = z.object({ inquiries: z.array(inquirySchema).max(20), hasMore: z.boolean() }).strict();
export const detailResultSchema = z.object({ inquiry: inquirySchema, messages: z.array(messageSchema).max(50), hasMore: z.boolean() }).strict();
export const inquiryListSchema = listResultSchema.omit({ hasMore: true }).extend({ nextCursor: z.string().nullable() }).strict();
export const inquiryDetailSchema = detailResultSchema.omit({ hasMore: true }).extend({ nextCursor: z.string().nullable() }).strict();
export type Inquiry = z.infer<typeof inquirySchema>;
export type SupportMessage = z.infer<typeof messageSchema>;
export type InquiryDetail = z.infer<typeof inquiryDetailSchema>;
export type InquiryList = z.infer<typeof inquiryListSchema>;
