import { z } from "zod";

import {
  levelSchema,
  mintStatusSchema,
  stampTypeSchema,
} from "../../passport/domain/passport-read-model";

export const fanActivityCompletionSchema = z
  .object({
    passportId: z.string().uuid(),
    earnedStamp: z
      .object({
        id: z.string().uuid(),
        type: stampTypeSchema,
        issuedAt: z.string().datetime({ offset: true }),
        businessStatus: z.literal("issued"),
        mintStatus: mintStatusSchema,
      })
      .strict(),
    scoreDelta: z.number().int().positive(),
    updatedScore: z.number().int().nonnegative(),
    updatedLevel: levelSchema,
    leveledUp: z.boolean(),
  })
  .strict()
  .superRefine((completion, context) => {
    if (completion.updatedScore < completion.scoreDelta) {
      context.addIssue({
        code: "custom",
        message: "updated score cannot be lower than the activity delta",
      });
    }
  });

export type FanActivityCompletion = z.infer<
  typeof fanActivityCompletionSchema
>;
