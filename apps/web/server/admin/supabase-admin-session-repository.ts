import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AdminAllowlistEntry } from "../../features/auth/domain/admin-authorization";
import type { AppUser } from "../repositories/identity-repository";
import type { AdminAuthorizationAudit, AdminSessionRepository } from "./admin-session-gate";

type DatabaseClient = Pick<SupabaseClient, "from">;

function assertNoError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export function createSupabaseAdminSessionRepository(
  config: { url: string; serviceRoleKey: string },
  client?: DatabaseClient,
): AdminSessionRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async findUserByPrivyId(privyUserId): Promise<AppUser | null> {
      const { data, error } = await database
        .from("app_users")
        .select("id, privy_user_id, verified_email, status")
        .eq("privy_user_id", privyUserId)
        .maybeSingle();
      assertNoError(error, "app user lookup");
      if (!data) return null;
      return {
        id: data.id,
        privyUserId: data.privy_user_id,
        verifiedEmail: data.verified_email,
        status: data.status,
      };
    },

    async findActiveAdminByEmail(normalizedEmail): Promise<AdminAllowlistEntry | null> {
      const { data, error } = await database
        .from("admin_allowlist")
        .select("id, email, role, active")
        .eq("email", normalizedEmail)
        .eq("active", true)
        .maybeSingle();
      assertNoError(error, "admin allowlist lookup");
      return data as AdminAllowlistEntry | null;
    },

    async appendAuthorizationAudit(event: AdminAuthorizationAudit): Promise<void> {
      const { error } = await database.from("audit_logs").insert({
        actor_app_user_id: event.actorAppUserId,
        actor_admin_allowlist_id: event.actorAdminAllowlistId,
        action: event.action,
        entity_type: "admin_session",
        entity_id: null,
        correlation_id: event.correlationId,
        before_after_summary: event.summary,
      });
      assertNoError(error, "admin authorization audit append");
    },
  };
}
