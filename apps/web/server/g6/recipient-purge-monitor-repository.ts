import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const recipientPurgeStatusSchema = z.object({
  state: z.enum(["never_run", "healthy", "overdue", "error"]),
  cadenceHours: z.literal(24),
  lastRunAt: z.string().datetime({ offset: true }).nullable(),
  lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
  lastErrorCode: z.enum(["PURGE_RPC_FAILED", "PURGE_EVIDENCE_FAILED"]).nullable(),
  deletedCount: z.number().int().nonnegative().nullable(),
  source: z.literal("benefit_maintenance_runs(recipient_purge)"),
}).strict();
export type RecipientPurgeStatus = z.infer<typeof recipientPurgeStatusSchema>;
type RpcClient = Pick<SupabaseClient, "rpc">;
export interface RecipientPurgeMonitorRepository {
  read(input: { appUserId: string; allowlistId: string; asOf: Date }): Promise<RecipientPurgeStatus>;
}
export function createSupabaseRecipientPurgeMonitorRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): RecipientPurgeMonitorRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return { async read(input) {
    const { data, error } = await db.rpc("read_admin_recipient_purge_status", {
      p_actor_app_user_id: input.appUserId,
      p_actor_admin_allowlist_id: input.allowlistId,
      p_as_of: input.asOf.toISOString(),
    });
    if (error) throw new Error("RECIPIENT_PURGE_STATUS_UNAVAILABLE");
    return recipientPurgeStatusSchema.parse(data);
  } };
}
