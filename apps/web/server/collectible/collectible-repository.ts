import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  collectibleClaimResultSchema,
  collectibleOwnedStateSchema,
  type CollectibleClaim,
  type CollectibleOwnedState,
} from "../../features/collectible/domain/collectible";

export type CollectibleRepositoryFailureCode =
  | "COLLECTIBLE_NOT_FOUND"
  | "JOURNEY_INCOMPLETE"
  | "CLAIM_WINDOW_NOT_OPEN"
  | "CLAIM_WINDOW_EXPIRED"
  | "WALLET_NOT_READY"
  | "IDEMPOTENCY_CONFLICT"
  | "COLLECTIBLE_UNAVAILABLE";

export class CollectibleRepositoryError extends Error {
  constructor(readonly code: CollectibleRepositoryFailureCode) {
    super(code);
    this.name = "CollectibleRepositoryError";
  }
}

export interface CollectibleRepository {
  getOwned(input: { appUserId: string; liveSlug: string }): Promise<CollectibleOwnedState>;
  claimOwned(input: { appUserId: string; liveSlug: string; idempotencyKey: string }): Promise<{ claim: CollectibleClaim; replayed: boolean }>;
}

export interface CollectibleRpcClient {
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

function mapRpcError(error: { message?: string }): CollectibleRepositoryError {
  const message = error.message ?? "";
  const mappings: ReadonlyArray<[string, CollectibleRepositoryFailureCode]> = [
    ["P3_COLLECTIBLE_JOURNEY_INCOMPLETE", "JOURNEY_INCOMPLETE"],
    ["P3_COLLECTIBLE_WINDOW_NOT_OPEN", "CLAIM_WINDOW_NOT_OPEN"],
    ["P3_COLLECTIBLE_WINDOW_EXPIRED", "CLAIM_WINDOW_EXPIRED"],
    ["P3_COLLECTIBLE_WALLET_NOT_READY", "WALLET_NOT_READY"],
    ["P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT"],
    ["P3_COLLECTIBLE_NOT_FOUND", "COLLECTIBLE_NOT_FOUND"],
  ];
  return new CollectibleRepositoryError(mappings.find(([marker]) => message.includes(marker))?.[1] ?? "COLLECTIBLE_UNAVAILABLE");
}

export class SupabaseCollectibleRepository implements CollectibleRepository {
  constructor(private readonly client: CollectibleRpcClient) {}

  async getOwned(input: { appUserId: string; liveSlug: string }): Promise<CollectibleOwnedState> {
    const { data, error } = await this.client.rpc("get_owned_live_collectible", {
      p_app_user_id: input.appUserId,
      p_live_slug: input.liveSlug,
    });
    if (error) throw mapRpcError(error);
    const parsed = collectibleOwnedStateSchema.safeParse(data);
    if (!parsed.success) throw new CollectibleRepositoryError("COLLECTIBLE_UNAVAILABLE");
    return parsed.data;
  }

  async claimOwned(input: { appUserId: string; liveSlug: string; idempotencyKey: string }): Promise<{ claim: CollectibleClaim; replayed: boolean }> {
    const { data, error } = await this.client.rpc("claim_owned_live_collectible", {
      p_app_user_id: input.appUserId,
      p_live_slug: input.liveSlug,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapRpcError(error);
    const parsed = collectibleClaimResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new CollectibleRepositoryError("COLLECTIBLE_UNAVAILABLE");
    }
    return parsed.data;
  }
}

export function createCollectibleRepositoryFromEnvironment(config: { url: string; serviceRoleKey: string }, existingClient?: CollectibleRpcClient): CollectibleRepository {
  const client = existingClient ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseCollectibleRepository(client as unknown as CollectibleRpcClient);
}
