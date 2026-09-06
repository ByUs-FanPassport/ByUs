import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  creatorReactionStatesSchema,
  type CreatorReactionState,
} from "../../features/reaction/domain/creator-reaction-batch";
import { ReactionRepositoryError } from "./reaction-repository";

interface BatchRpcClient {
  rpc(name: string, parameters: Record<string, string | readonly string[]>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface CreatorReactionBatchRepository {
  findMany(input: { appUserId: string; celebritySlugs: readonly string[] }): Promise<readonly CreatorReactionState[]>;
}

export class SupabaseCreatorReactionBatchRepository implements CreatorReactionBatchRepository {
  constructor(private readonly client: BatchRpcClient) {}

  async findMany(input: { appUserId: string; celebritySlugs: readonly string[] }): Promise<readonly CreatorReactionState[]> {
    const { data, error } = await this.client.rpc("get_owned_creator_reactions", {
      p_app_user_id: input.appUserId,
      p_celebrity_slugs: input.celebritySlugs,
    });
    if (error) throw new ReactionRepositoryError("REACTION_UNAVAILABLE");
    const parsed = creatorReactionStatesSchema.safeParse(data);
    if (!parsed.success) throw new ReactionRepositoryError("REACTION_UNAVAILABLE");
    const requested = new Set(input.celebritySlugs);
    const returned = new Set(parsed.data.map((state) => state.slug));
    if (returned.size !== parsed.data.length || returned.size !== requested.size || [...requested].some((slug) => !returned.has(slug))) {
      throw new ReactionRepositoryError("REACTION_UNAVAILABLE");
    }
    return parsed.data;
  }
}

export function createCreatorReactionBatchRepositoryFromEnvironment(config: { url: string; serviceRoleKey: string }): CreatorReactionBatchRepository {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseCreatorReactionBatchRepository(client as unknown as BatchRpcClient);
}
