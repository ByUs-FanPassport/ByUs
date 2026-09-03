import { z } from "zod";

export const collectibleMintStatusSchema = z.enum([
  "queued", "processing", "retryable", "permanent_failure", "minted",
]);

export const collectibleClaimSchema = z.object({
  id: z.string().uuid(),
  liveEventId: z.string().uuid(),
  journeyCompletionId: z.string().uuid(),
  businessStatus: z.literal("claimed"),
  claimedAt: z.iso.datetime({ offset: true }),
  mint: z.object({
    status: collectibleMintStatusSchema,
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
    tokenId: z.string().regex(/^[1-9][0-9]*$/).nullable(),
  }).strict(),
}).strict().superRefine((claim, context) => {
  const hasResult = claim.mint.txHash !== null || claim.mint.tokenId !== null;
  if (claim.mint.status === "minted" && (!claim.mint.txHash || !claim.mint.tokenId)) {
    context.addIssue({ code: "custom", path: ["mint"], message: "minted claim requires a chain result" });
  }
  if (claim.mint.status !== "minted" && hasResult) {
    context.addIssue({ code: "custom", path: ["mint"], message: "unminted claim cannot expose a chain result" });
  }
});

export const collectibleClaimWindowSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  until: z.iso.datetime({ offset: true }),
}).strict().superRefine((window, context) => {
  if (Date.parse(window.until) <= Date.parse(window.from)) {
    context.addIssue({ code: "custom", path: ["until"], message: "claim window must be positive" });
  }
});

export const collectibleOwnedStateSchema = z.object({
  eligible: z.boolean(),
  claimWindow: collectibleClaimWindowSchema,
  claim: collectibleClaimSchema.nullable(),
}).strict();

export const claimCollectibleRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
}).strict();

export const collectibleClaimResultSchema = z.object({
  claim: collectibleClaimSchema,
  replayed: z.boolean(),
}).strict();

export type CollectibleClaim = z.infer<typeof collectibleClaimSchema>;
export type CollectibleOwnedState = z.infer<typeof collectibleOwnedStateSchema>;
