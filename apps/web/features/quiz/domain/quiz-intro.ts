import { z } from "zod";

const publicQuizIntroSchema = z
  .object({
    celebrity: z
      .object({
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: z.string().trim().min(1).max(120),
      })
      .strict(),
    quiz: z
      .object({
        availability: z.enum(["available", "unavailable"]),
        totalQuestions: z.literal(3),
        passThreshold: z.literal(2),
      })
      .strict(),
  })
  .strict();

export type PublicQuizIntro = z.infer<typeof publicQuizIntroSchema>;

export function parsePublicQuizIntro(value: unknown): PublicQuizIntro {
  return publicQuizIntroSchema.parse(value);
}
