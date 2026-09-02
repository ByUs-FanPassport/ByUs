import { z } from "zod";

export const reactionResultSchema = z.object({
  reactionId: z.uuid(),
  status: z.literal("completed"),
  mintStatus: z.enum(["queued", "processing", "minted", "retryable", "permanent_failure"]),
  blockchainJobId: z.uuid(),
  created: z.boolean(),
  passportExists: z.boolean(),
}).strict();

export type ReactionResult = z.infer<typeof reactionResultSchema>;
