import { z } from "zod";
import {
  fulfillmentMethodSchema,
  fulfillmentStatusSchema,
  type FulfillmentMethod,
  type FulfillmentStatus,
} from "./fulfillment";

export type MyReward = {
  rewardResultId: string;
  winnerId: string | null;
  benefitId: string;
  title: string;
  campaignId: string;
  result: "won" | "not_selected";
  method: FulfillmentMethod | null;
  status: FulfillmentStatus | "not_selected";
  enteredTickets: number;
  recipientRequired: boolean;
  updatedAt: string;
  benefitHref: string;
};

export const myRewardSchema = z
  .object({
    rewardResultId: z.string().uuid(),
    winnerId: z.string().uuid().nullable(),
    benefitId: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    campaignId: z.string().uuid(),
    result: z.enum(["won", "not_selected"]),
    method: fulfillmentMethodSchema.nullable(),
    status: z.union([fulfillmentStatusSchema, z.literal("not_selected")]),
    enteredTickets: z.number().int().nonnegative(),
    recipientRequired: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }),
    benefitHref: z.string().regex(/^\/benefits\/[0-9a-f-]{36}$/),
  })
  .strict()
  .superRefine((reward, context) => {
    if (reward.result === "not_selected") {
      if (
        reward.winnerId !== null ||
        reward.method !== null ||
        reward.status !== "not_selected" ||
        reward.recipientRequired
      )
        context.addIssue({ code: "custom", message: "invalid non-selected reward" });
      return;
    }
    if (
      reward.winnerId === null ||
      reward.method === null ||
      reward.status === "not_selected"
    )
      context.addIssue({ code: "custom", message: "invalid winning reward" });
    const shouldRequire =
      reward.method !== "digital" && reward.status === "information_required";
    if (reward.recipientRequired !== shouldRequire)
      context.addIssue({
        code: "custom",
        message: "invalid recipient requirement",
      });
  });

export const myRewardsSchema = z.array(myRewardSchema);

export function parseMyRewards(value: unknown): MyReward[] {
  return myRewardsSchema.parse(value);
}
