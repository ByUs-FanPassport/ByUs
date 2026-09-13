import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  homeBannerManagerDataSchema,
  type HomeBannerCommand,
  type HomeBannerManagerData,
} from "../../features/home/domain/home-banner";
import type { AdminSession } from "../admin/admin-session-gate";

type RpcClient = Pick<SupabaseClient, "rpc">;

function result(data: unknown, error: { message: string } | null): unknown {
  if (error) throw new Error(error.message);
  return data;
}

export interface HomeBannerManagerRepository {
  read(actor: AdminSession): Promise<HomeBannerManagerData>;
  command(actor: AdminSession, correlationId: string, command: HomeBannerCommand): Promise<unknown>;
}

export function createHomeBannerManagerRepository(
  config: { url: string; serviceRoleKey: string }, client?: RpcClient,
): HomeBannerManagerRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async read(actor) {
      const { data, error } = await db.rpc("get_admin_home_banner_manager", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
      });
      return homeBannerManagerDataSchema.parse(result(data, error));
    },
    async command(actor, correlationId, command) {
      const common = {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
      };
      if (command.action === "save") {
        const { data, error } = await db.rpc("save_admin_home_banner", {
          ...common, p_banner_id: command.id, p_expected_revision: command.expectedRevision,
          p_kind: command.kind, p_celebrity_id: command.celebrityId,
          p_localizations: command.localizations,
        });
        return result(data, error);
      }
      if (command.action === "publication") {
        const { data, error } = await db.rpc("set_admin_home_banner_publication", {
          ...common, p_banner_id: command.id, p_expected_revision: command.expectedRevision,
          p_publication_status: command.publicationStatus,
        });
        return result(data, error);
      }
      const { data, error } = await db.rpc("reorder_admin_home_banners", { ...common, p_items: command.items });
      return result(data, error);
    },
  };
}
