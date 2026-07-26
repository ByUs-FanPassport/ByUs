import { z } from "zod";

export const livePreviewKindSchema = z.enum([
  "artist_teaser",
  "event_highlight",
]);

const derivativeFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  mime: z.enum(["video/mp4", "image/webp"]),
});

const derivativePairSchema = z.object({
  video: derivativeFileSchema,
  poster: derivativeFileSchema,
});

export const livePreviewDraftSchema = z
  .object({
    liveEventId: z.string().uuid(),
    kind: livePreviewKindSchema,
    durationMs: z.number().int().min(3_000).max(5_000),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    focal: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
    rights: z.object({
      holder: z.string().trim().min(1).max(300),
      basis: z.string().trim().min(1).max(1_000),
      sourceReference: z.string().trim().min(1).max(2_000),
    }),
    derivatives: z.object({
      square: derivativePairSchema,
      landscape: derivativePairSchema,
    }),
  })
  .superRefine((value, ctx) => {
    const expected = {
      square: { width: 720, height: 720 },
      landscape: { width: 1280, height: 640 },
    } as const;
    for (const ratio of ["square", "landscape"] as const) {
      const pair = value.derivatives[ratio];
      for (const file of ["video", "poster"] as const) {
        if (
          pair[file].width !== expected[ratio].width ||
          pair[file].height !== expected[ratio].height
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["derivatives", ratio, file],
            message: `INVALID_${ratio.toUpperCase()}_DIMENSIONS`,
          });
        }
      }
      if (
        pair.video.mime !== "video/mp4" ||
        pair.poster.mime !== "image/webp"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["derivatives", ratio],
          message: "INVALID_DERIVATIVE_MIME",
        });
      }
    }
  });

export type LivePreviewDraft = z.infer<typeof livePreviewDraftSchema>;

export function buildLivePreviewStoragePrefix(
  liveEventId: string,
  sourceSha256: string,
) {
  const id = z.string().uuid().parse(liveEventId);
  const sha = z.string().regex(/^[a-f0-9]{64}$/).parse(sourceSha256);
  return `live-previews/${id}/${sha}`;
}
