import "server-only";

import { createClient } from "@supabase/supabase-js";

import { productEventV1Schema, type ProductEventV1 } from "../../features/analytics/domain/product-event";

type RpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export class ProductEventRepositoryError extends Error {
  constructor(readonly code: "IDEMPOTENCY_CONFLICT" | "EVENT_UNAVAILABLE") {
    super(code);
    this.name = "ProductEventRepositoryError";
  }
}

export interface ProductEventRepository {
  record(input: ProductEventV1): Promise<{ id: string; replayed: boolean }>;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`byus-product-event-v1:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function singleResult(value: unknown): { id: string; replayed: boolean } {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new Error("missing event result");
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.replayed !== "boolean") throw new Error("invalid event result");
  return { id: record.id, replayed: record.replayed };
}

export class SupabaseProductEventRepository implements ProductEventRepository {
  constructor(private readonly client: RpcClient) {}

  async record(value: ProductEventV1): Promise<{ id: string; replayed: boolean }> {
    const input = productEventV1Schema.parse(value);
    const anonymousSessionHash = input.anonymousSessionId ? await sha256(input.anonymousSessionId) : null;
    const { data, error } = await this.client.rpc("record_product_event_v1", {
      p_schema_version: input.schemaVersion,
      p_event_name: input.eventName,
      p_app_user_id: input.appUserId,
      p_anonymous_session_hash: anonymousSessionHash,
      p_celebrity_id: input.celebrityId,
      p_live_event_id: input.liveEventId,
      p_mission_id: input.missionId,
      p_benefit_id: input.benefitId,
      p_source: input.source,
      p_idempotency_key: input.idempotencyKey,
      p_occurred_at: input.occurredAt,
      p_properties: input.properties,
    });
    if (error) {
      if (error.message?.includes("PRODUCT_EVENT_IDEMPOTENCY_CONFLICT") || error.code === "23514") {
        throw new ProductEventRepositoryError("IDEMPOTENCY_CONFLICT");
      }
      throw new ProductEventRepositoryError("EVENT_UNAVAILABLE");
    }
    try { return singleResult(data); }
    catch { throw new ProductEventRepositoryError("EVENT_UNAVAILABLE"); }
  }
}

export function createSupabaseProductEventRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): ProductEventRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseProductEventRepository(database as unknown as RpcClient);
}
