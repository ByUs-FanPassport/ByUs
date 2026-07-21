import { z } from "zod";

const mintStatusSchema = z.enum([
  "queued",
  "processing",
  "minted",
  "retryable",
  "permanent_failure",
]);

const tokenIdSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);

const credentialSchema = z
  .object({
    businessStatus: z.literal("issued"),
    mintStatus: mintStatusSchema,
    tokenId: tokenIdSchema.nullable(),
    issuedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((credential, context) => {
    const tokenShapeIsValid = credential.mintStatus === "minted"
      ? credential.tokenId !== null && credential.tokenId !== "0"
      : credential.tokenId === null;
    if (!tokenShapeIsValid) {
      context.addIssue({ code: "custom", message: "Token ID contradicts mint status" });
    }
  });

const issuanceAggregateSchema = z
  .object({
    passport: credentialSchema.extend({ id: z.uuid() }).strict(),
    celebrity: z
      .object({
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
        name: z.string().trim().min(1).max(120),
        image: z
          .object({
            url: z.string().refine((value) => value.startsWith("/") || value.startsWith("https://")),
            alt: z.string().trim().min(1).max(300),
            position: z.string().trim().min(1).max(100),
          })
          .strict(),
      })
      .strict(),
    firstStamp: credentialSchema.extend({ type: z.literal("knowledge") }).strict(),
    score: z.object({ points: z.literal(1) }).strict(),
  })
  .strict();

export type IssuanceAggregate = z.infer<typeof issuanceAggregateSchema>;

export function parseIssuanceAggregate(value: unknown): IssuanceAggregate {
  return issuanceAggregateSchema.parse(value);
}
