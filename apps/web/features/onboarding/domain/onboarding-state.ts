import { z } from "zod";

export const onboardingStateSchema = z.object({
  completed: z.object({
    profile: z.boolean(),
    verify: z.boolean(),
    reserve: z.boolean(),
  }),
  dismissed: z.boolean(),
});

export type OnboardingState = z.infer<typeof onboardingStateSchema>;
