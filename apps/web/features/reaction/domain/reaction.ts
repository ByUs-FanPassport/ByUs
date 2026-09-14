import { z } from "zod";

export const reactionResultSchema = z.object({
  reactionId: z.uuid(),
  status: z.literal("completed"),
  mintStatus: z.enum(["queued", "processing", "minted", "retryable", "permanent_failure"]),
  // Fan Action reactions use an outbox instead of a legacy blockchain job.
  // The write RPC includes the outbox ID; the owned read projection omits it.
  blockchainJobId: z.uuid().nullable(),
  fanActionOutboxId: z.uuid().nullable().optional(),
  created: z.boolean(),
  passportExists: z.boolean(),
}).strict();

export type ReactionResult = z.infer<typeof reactionResultSchema>;
