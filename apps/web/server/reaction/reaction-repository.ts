import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deriveCredentialId } from "../../features/passport/domain/credential-issuance";
import { reactionResultSchema, type ReactionResult } from "../../features/reaction/domain/reaction";

export type ReactionFailureCode = "CREATOR_NOT_FOUND" | "WALLET_NOT_READY" | "USER_UNAVAILABLE" | "REACTION_UNAVAILABLE";

export class ReactionRepositoryError extends Error {
  constructor(readonly code: ReactionFailureCode) { super(code); this.name = "ReactionRepositoryError"; }
}

interface RpcClient {
  from(table: string): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: { id?: unknown } | null; error: { message?: string } | null }> } } };
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface ReactionRepository {
  react(input: { appUserId: string; celebritySlug: string }): Promise<ReactionResult>;
}

const failureMap: Readonly<Record<string, ReactionFailureCode>> = {
  P2_CREATOR_NOT_FOUND: "CREATOR_NOT_FOUND",
  P2_WALLET_NOT_READY: "WALLET_NOT_READY",
  P2_USER_UNAVAILABLE: "USER_UNAVAILABLE",
};

export class SupabaseReactionRepository implements ReactionRepository {
  constructor(private readonly client: RpcClient, private readonly createId: () => string = randomUUID) {}

  async react(input: { appUserId: string; celebritySlug: string }): Promise<ReactionResult> {
    const creator = await this.client.from("celebrities").select("id").eq("slug", input.celebritySlug).maybeSingle();
    if (creator.error || typeof creator.data?.id !== "string") throw new ReactionRepositoryError("CREATOR_NOT_FOUND");
    const reactionId = this.createId();
    const operationKey = `byus:reaction:v1:${reactionId}`;
    const { data, error } = await this.client.rpc("react_to_creator", {
      p_app_user_id: input.appUserId,
      p_celebrity_id: creator.data.id,
      p_reaction_id: reactionId,
      p_job_id: this.createId(),
      p_issuance_id: deriveCredentialId(operationKey),
    });
    if (error) {
      const marker = Object.keys(failureMap).find((candidate) => error.message?.includes(candidate));
      throw new ReactionRepositoryError(marker ? failureMap[marker] : "REACTION_UNAVAILABLE");
    }
    const parsed = reactionResultSchema.safeParse(data);
    if (!parsed.success) throw new ReactionRepositoryError("REACTION_UNAVAILABLE");
    return parsed.data;
  }
}

export function createReactionRepositoryFromEnvironment(config: { url: string; serviceRoleKey: string }): ReactionRepository {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseReactionRepository(client as unknown as RpcClient);
}
