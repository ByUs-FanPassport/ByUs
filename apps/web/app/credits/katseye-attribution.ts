import "server-only";

import { z } from "zod";

import rawAttribution from "../../public/images/celebrities/katseye/attribution.json";

const httpsUrl = z.string().url().startsWith("https://");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const publicImagePath = z
  .string()
  .regex(/^\/images\/celebrities\/katseye\/[a-z0-9-]+\.webp$/);

const derivativeSchema = z.object({
  path: publicImagePath,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  sha256,
  encoder: z.string().min(1),
  crop: z.object({
    aspectRatio: z.string().regex(/^\d+:\d+$/),
    gravity: z.literal("center"),
  }),
  changes: z.string().min(1),
});

const attributionSchema = z
  .object({
    datasetKey: z.literal("katseye-public-assets-v1"),
    downloadedAt: z.string().datetime({ offset: true }),
    license: z.object({
      name: z.string().min(1),
      shortName: z.literal("CC BY 4.0"),
      url: httpsUrl,
    }),
    sources: z
      .array(
        z.object({
          title: z.string().min(1),
          filePage: httpsUrl,
          downloadUrl: httpsUrl,
          author: z.string().min(1),
          sha256,
          derivatives: z.array(derivativeSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((manifest, context) => {
    const paths = manifest.sources.flatMap((source) =>
      source.derivatives.map((derivative) => derivative.path),
    );
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        message: "Derivative paths must be unique",
      });
    }
  });

export const katseyeAttribution = attributionSchema.parse(rawAttribution);
