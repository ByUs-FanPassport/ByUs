import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  adminDirectoryEntrySchema, adminDirectorySchema,
  type AdminDirectory, type AdminDirectoryEntry,
  type CreateAdminDirectoryInput, type UpdateAdminDirectoryInput,
} from "../../features/auth/domain/admin-directory";
import type { AdminSession } from "./admin-session-gate";

const errorCodes = [
  "ADMIN_DIRECTORY_FORBIDDEN", "ADMIN_DIRECTORY_DUPLICATE_EMAIL",
  "ADMIN_DIRECTORY_NOT_FOUND", "ADMIN_DIRECTORY_SELF_CHANGE",
  "ADMIN_DIRECTORY_LAST_ADMIN", "ADMIN_DIRECTORY_CONFLICT", "ADMIN_DIRECTORY_INVALID_INPUT",
  "ADMIN_DIRECTORY_UNAVAILABLE",
] as const;
export type AdminDirectoryErrorCode = typeof errorCodes[number];
export class AdminDirectoryRepositoryError extends Error {
  constructor(readonly code: AdminDirectoryErrorCode = "ADMIN_DIRECTORY_UNAVAILABLE") { super(code); }
}
export interface AdminDirectoryRepository {
  read(actor: AdminSession): Promise<AdminDirectory>;
  create(actor: AdminSession, input: CreateAdminDirectoryInput, correlationId: string): Promise<AdminDirectoryEntry>;
  update(actor: AdminSession, input: UpdateAdminDirectoryInput, correlationId: string): Promise<AdminDirectoryEntry>;
}
export function createAdminDirectoryRepository(
  config: { url: string; serviceRoleKey: string }, client?: Pick<SupabaseClient, "rpc">,
): AdminDirectoryRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const actorArgs = (actor: AdminSession) => ({
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
  });
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      // Match only known application messages. Never relay SQL/details or emails.
      const code = errorCodes.find((value) => value === error.message);
      throw new AdminDirectoryRepositoryError(code);
    }
    return data;
  }
  function entry(data: unknown) {
    const parsed = adminDirectoryEntrySchema.safeParse(data);
    if (!parsed.success) throw new AdminDirectoryRepositoryError();
    return parsed.data;
  }
  return {
    async read(actor) {
      const result = adminDirectorySchema.safeParse(await call("read_admin_directory", actorArgs(actor)));
      if (!result.success) throw new AdminDirectoryRepositoryError();
      return result.data;
    },
    async create(actor, input, correlationId) {
      return entry(await call("create_admin_directory_entry", {
        ...actorArgs(actor), p_correlation_id: correlationId, p_email: input.email, p_role: input.role,
      }));
    },
    async update(actor, input, correlationId) {
      return entry(await call("update_admin_directory_entry", {
        ...actorArgs(actor), p_correlation_id: correlationId, p_id: input.id,
        p_role: input.role, p_active: input.active, p_expected_updated_at: input.expectedUpdatedAt,
      }));
    },
  };
}
