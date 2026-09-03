import { z } from "zod";

export const PRODUCT_EVENT_NAMES = [
  "creator_page_view",
  "live_page_view",
  "live_cta_click",
  "benefit_page_view",
  "reaction_completed",
  "passport_issued",
  "reservation_completed",
  "attendance_completed",
  "mission_completed",
  "ticket_credited",
  "ticket_debited",
  "journey_completed",
  "collectible_claimed",
  "benefit_entered",
  "benefit_won",
  "fulfillment_completed",
] as const;

export const productEventNameSchema = z.enum(PRODUCT_EVENT_NAMES);
export type ProductEventName = z.infer<typeof productEventNameSchema>;

const primitiveSchema = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
const propertiesSchema = z.record(z.string().min(1).max(80), primitiveSchema)
  .superRefine((properties, context) => {
    if (Object.keys(properties).length > 20) {
      context.addIssue({ code: "custom", message: "Too many event properties" });
    }
    if (new TextEncoder().encode(JSON.stringify(properties)).byteLength > 2_048) {
      context.addIssue({ code: "custom", message: "Event properties are too large" });
    }
  });

const productEventV1BaseSchema = z.object({
  schemaVersion: z.literal(1),
  eventName: productEventNameSchema,
  appUserId: z.uuid().nullable(),
  anonymousSessionId: z.string().min(16).max(200).nullable(),
  celebrityId: z.uuid().nullable(),
  liveEventId: z.uuid().nullable(),
  missionId: z.uuid().nullable(),
  benefitId: z.uuid().nullable(),
  source: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,99}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,199}$/),
  occurredAt: z.iso.datetime({ offset: true }),
  properties: propertiesSchema,
}).strict();

export const productEventV1Schema = productEventV1BaseSchema.superRefine((event, context) => {
  if ((event.appUserId === null) === (event.anonymousSessionId === null)) {
    context.addIssue({ code: "custom", message: "Exactly one event owner is required" });
  }
});

export const clientProductEventV1Schema = productEventV1BaseSchema
  .omit({ appUserId: true })
  .refine((event) => event.eventName !== "ticket_credited" && event.eventName !== "ticket_debited", {
    message: "Ticket events are server-only",
    path: ["eventName"],
  });

export type ProductEventV1 = z.infer<typeof productEventV1Schema>;
export type ClientProductEventV1 = z.infer<typeof clientProductEventV1Schema>;

export function assertSafeProductEventTime(occurredAt: string, now: Date): void {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid event time");
  if (timestamp > now.getTime() + 5 * 60_000 || timestamp < now.getTime() - 24 * 60 * 60_000) {
    throw new Error("Unsafe event time");
  }
}
