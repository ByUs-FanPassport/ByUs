import "server-only";
import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../config/env";
import { createLiveManagerRouteDependencies } from "./live-manager-route-dependencies";
import type { RecurringLiveRouteDependencies } from "./recurring-live-route";

export function createRecurringLiveRouteDependencies(): RecurringLiveRouteDependencies {
  const existing = createLiveManagerRouteDependencies();
  const env = loadServerEnv();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    authorize: existing.authorize,
    invalidatePublicContent: existing.invalidatePublicContent,
    async read(actor) {
      const [schedules, roster] = await Promise.all([
        db.rpc("get_admin_recurring_live_schedules", { p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId }),
        db.rpc("get_recurring_live_roster"),
      ]);
      if (schedules.error || roster.error) throw new Error("Recurring schedule lookup failed");
      return { ...schedules.data, roster: roster.data };
    },
    async resolve(actor, input, correlationId) {
      const { data, error } = await db.rpc("resolve_admin_recurring_live_review", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_revision_id: input.revisionId, p_expected_current_revision_id: input.expectedCurrentRevisionId,
        p_resolution: input.resolution, p_correlation_id: correlationId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  };
}
