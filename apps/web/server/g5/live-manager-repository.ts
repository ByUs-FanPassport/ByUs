import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type LiveManagerActor = { appUserId: string; allowlistId: string };
export type LiveManagerRepository = {
  read(actor: LiveManagerActor): Promise<Record<string, unknown>>;
  save(actor: LiveManagerActor, correlationId: string, input: Record<string, unknown>): Promise<string>;
  publication(actor: LiveManagerActor, correlationId: string, id: string, published: boolean): Promise<void>;
  archive(actor: LiveManagerActor, correlationId: string, id: string, reason: string): Promise<void>;
  override(actor: LiveManagerActor, correlationId: string, id: string, input: Record<string, unknown>): Promise<string>;
};

type RpcClient = Pick<SupabaseClient, "rpc">;

function assert(data: unknown, error: { message: string } | null): unknown {
  if (error) throw new Error(error.message);
  return data;
}

export function createSupabaseLiveManagerRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): LiveManagerRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async read(actor) {
      const { data, error } = await db.rpc("get_admin_live_manager", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_live_event_id: null,
      });
      return assert(data, error) as Record<string, unknown>;
    },
    async save(actor, correlationId, input) {
      const { data, error } = await db.rpc("save_admin_live_draft", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId, p_live_event_id: input.id ?? null, p_slug: input.slug,
        p_celebrity_id: input.celebrityId, p_brand_id: input.brandId,
        p_starts_at: input.startsAt, p_ends_at: input.endsAt,
        p_reservation_opens_at: input.reservationOpensAt, p_reservation_closes_at: input.reservationClosesAt,
        p_youtube_url: input.youtubeUrl, p_hero_url: input.heroUrl,
        p_fan_code_plaintext: input.fanCode || null,
        p_title_ko: input.titleKo, p_summary_ko: input.summaryKo, p_hero_alt_ko: input.heroAltKo,
        p_title_en: input.titleEn, p_summary_en: input.summaryEn, p_hero_alt_en: input.heroAltEn,
      });
      return String(assert(data, error));
    },
    async publication(actor, correlationId, id, published) {
      const { error } = await db.rpc("set_admin_live_publication", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId, p_live_event_id: id, p_published: published,
      });
      assert(null, error);
    },
    async archive(actor, correlationId, id, reason) {
      const { error } = await db.rpc("archive_admin_live", {
        p_actor_app_user_id: actor.appUserId, p_live_event_id: id, p_actor_admin_allowlist_id: actor.allowlistId,
        p_reason: reason, p_correlation_id: correlationId,
      });
      assert(null, error);
    },
    async override(actor, correlationId, id, input) {
      const { data, error } = await db.rpc("create_admin_live_status_override", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId, p_live_event_id: id,
        p_effective_status: input.status, p_effective_from: input.effectiveFrom,
        p_effective_until: input.effectiveUntil || null, p_reason: input.reason,
      });
      return String(assert(data, error));
    },
  };
}
