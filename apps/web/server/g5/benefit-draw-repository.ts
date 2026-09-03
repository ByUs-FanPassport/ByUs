import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  BENEFIT_DRAW_ALGORITHM,
  type BenefitDrawResult,
} from "../../features/benefit/domain/weighted-draw";

const resultSchema = z.object({
  drawId: z.string().uuid(),
  campaignId: z.string().uuid(),
  algorithm: z.literal(BENEFIT_DRAW_ALGORITHM),
  seedHash: z.string().regex(/^[0-9a-f]{64}$/),
  executedAt: z.string().datetime({ offset: true }),
  candidateCount: z.number().int().nonnegative(),
  winners: z.array(z.object({
    winnerId: z.string().uuid(),
    benefitId: z.string().uuid(),
    appUserId: z.string().uuid(),
    weight: z.number().int().positive(),
  })),
  replayed: z.boolean(),
});

export type BenefitDrawActor = { appUserId: string; allowlistId: string };
export interface BenefitDrawRepository {
  execute(input: {
    actor: BenefitDrawActor;
    correlationId: string;
    campaignId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<BenefitDrawResult>;
}

export class BenefitDrawRepositoryError extends Error {
  constructor(readonly code: "NOT_READY" | "ALREADY_EXECUTED" | "CONFLICT" | "UNAVAILABLE") {
    super(code);
  }
}

type RpcClient = Pick<SupabaseClient, "rpc">;
function map(message = "") {
  if (message.includes("ENTRY_OPEN") || message.includes("NOT_PUBLISHED"))
    return new BenefitDrawRepositoryError("NOT_READY");
  if (message.includes("ALREADY_EXECUTED"))
    return new BenefitDrawRepositoryError("ALREADY_EXECUTED");
  if (message.includes("IDEMPOTENCY_CONFLICT"))
    return new BenefitDrawRepositoryError("CONFLICT");
  return new BenefitDrawRepositoryError("UNAVAILABLE");
}

export function createSupabaseBenefitDrawRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): BenefitDrawRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async execute(input) {
      const { data, error } = await db.rpc("execute_admin_benefit_draw", {
        p_actor_app_user_id: input.actor.appUserId,
        p_actor_admin_allowlist_id: input.actor.allowlistId,
        p_correlation_id: input.correlationId,
        p_campaign_id: input.campaignId,
        p_idempotency_key: input.idempotencyKey,
        p_now: input.now.toISOString(),
      });
      if (error) throw map(error.message);
      const parsed = resultSchema.safeParse(data);
      if (!parsed.success) throw new BenefitDrawRepositoryError("UNAVAILABLE");
      return parsed.data;
    },
  };
}
