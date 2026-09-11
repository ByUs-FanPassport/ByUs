import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const status = z.enum(["pending", "processing", "sent", "failed"]);
const providerStatus = z.enum(["prepared", "sending", "accepted", "unknown", "delivered", "failed", "suppressed"]);
const item = z.object({
  id: z.string().uuid(), channel: z.enum(["push", "email", "kakao"]), kind: z.string().min(1), status,
  attemptCount: z.number().int().nonnegative(), nextAttemptAt: z.string().datetime({ offset: true }),
  destinationLabel: z.string().min(1).max(160), errorCode: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }), sentAt: z.string().datetime({ offset: true }).nullable(),
  manuallyRetryable: z.boolean(), providerStatus: providerStatus.nullish().transform((value) => value ?? null),
  providerMessageId: z.string().regex(/^[A-Za-z0-9_-]{2,128}$/).nullish().transform((value) => value ?? null),
  providerStatusCode: z.string().max(128).nullish().transform((value) => value ?? null),
}).strict();
const counts = z.object({
  pending: z.number().int().nonnegative(), processing: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
}).strict();
const result = z.object({ counts, items: z.array(item) }).strict();

export type NotificationDeliveryStatus = z.infer<typeof status>;
export interface NotificationDeliveryCursor { createdAt: string; id: string }
export type NotificationDeliveryMonitor = z.infer<typeof result> & { nextCursor: NotificationDeliveryCursor | null };
export interface NotificationMonitorActor { appUserId: string; allowlistId: string }
export class NotificationMonitorError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_RETRYABLE" | "UNAVAILABLE") { super(code); }
}

type RpcClient = Pick<SupabaseClient, "rpc">;
function classify(message: string) {
  if (message.includes("viewer role") || message.includes("administrator is required")) return new NotificationMonitorError("FORBIDDEN");
  if (message.includes("not final failed") || message.includes("idempotency")) return new NotificationMonitorError("NOT_RETRYABLE");
  return new NotificationMonitorError("UNAVAILABLE");
}

export interface NotificationMonitorRepository {
  list(input: { actor: NotificationMonitorActor; status: NotificationDeliveryStatus | null; limit: number; cursor?: NotificationDeliveryCursor }): Promise<NotificationDeliveryMonitor>;
  retry(input: { actor: NotificationMonitorActor; deliveryId: string; idempotencyKey: string; correlationId: string; now: Date }): Promise<{ id: string; status: "pending"; retried: boolean }>;
}

export function createSupabaseNotificationMonitorRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): NotificationMonitorRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    async list(input) {
      const { data, error } = await db.rpc("get_admin_notification_deliveries", {
        p_actor_app_user_id: input.actor.appUserId,
        p_actor_admin_allowlist_id: input.actor.allowlistId,
        p_status: input.status,
        p_limit: input.limit + 1,
        p_cursor_created_at: input.cursor?.createdAt ?? null,
        p_cursor_id: input.cursor?.id ?? null,
      });
      if (error) throw classify(error.message);
      try {
        const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : data;
        const normalizedItems = raw && Array.isArray(raw.items)
          ? raw.items.map((value: unknown) => value && typeof value === "object" && !Array.isArray(value)
            ? { ...value as Record<string, unknown>, nextAttemptAt: (value as Record<string, unknown>).nextAttemptAt === "infinity" ? "9999-12-31T23:59:59Z" : (value as Record<string, unknown>).nextAttemptAt }
            : value)
          : undefined;
        const parsed = result.parse(raw && typeof raw === "object" ? { ...raw, items: normalizedItems } : raw);
        const visible = parsed.items.slice(0, input.limit);
        const last = visible.at(-1);
        return {
          counts: parsed.counts,
          items: visible,
          nextCursor: parsed.items.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
        };
      } catch { throw new NotificationMonitorError("UNAVAILABLE"); }
    },
    async retry(input) {
      const { data, error } = await db.rpc("admin_retry_notification_delivery", {
        p_delivery_id: input.deliveryId, p_actor_app_user_id: input.actor.appUserId,
        p_actor_admin_allowlist_id: input.actor.allowlistId, p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId, p_now: input.now.toISOString(),
      });
      if (error) throw classify(error.message);
      return z.object({ id: z.string().uuid(), status: z.literal("pending"), retried: z.boolean() }).parse(data);
    },
  };
}
