import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuidSchema = z.string().uuid();
const auditRowSchema = z.object({
  id: z.string().regex(/^[1-9][0-9]*$/),
  actor_type: z.enum(["admin", "app_user", "system"]),
  actor_id: uuidSchema.nullable(),
  actor_role: z.enum(["admin", "operator", "viewer"]).nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  result: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()),
  correlation_id: uuidSchema,
  created_at: z.string().datetime({ offset: true }),
});

export interface AuditLogCursor {
  createdAt: string;
  id: string;
}

export interface AuditLogFilters {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  result?: string;
  createdFrom?: string;
  createdTo?: string;
  correlationId?: string;
}

export interface AuditLogItem {
  id: string;
  actor: { type: "admin" | "app_user" | "system"; id: string | null; role: "admin" | "operator" | "viewer" | null };
  action: string;
  entity: { type: string; id: string | null };
  result: string | null;
  summary: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  nextCursor: AuditLogCursor | null;
}

export interface AuditLogRepository {
  read(input: {
    adminAllowlistId: string;
    limit: number;
    cursor?: AuditLogCursor;
    filters: AuditLogFilters;
  }): Promise<AuditLogPage>;
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

type DatabaseClient = RpcClient;

export class AuditLogRepositoryError extends Error {
  constructor() {
    super("AUDIT_LOGS_UNAVAILABLE");
    this.name = "AuditLogRepositoryError";
  }
}

export class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: {
    adminAllowlistId: string;
    limit: number;
    cursor?: AuditLogCursor;
    filters: AuditLogFilters;
  }): Promise<AuditLogPage> {
    const requested = input.limit + 1;
    const { data, error } = await this.database.rpc("read_admin_audit_logs", {
      p_actor_admin_allowlist_id: input.adminAllowlistId,
      p_limit: requested,
      p_cursor_created_at: input.cursor?.createdAt ?? null,
      p_cursor_id: input.cursor?.id ?? null,
      p_actor_id: input.filters.actorId ?? null,
      p_entity_type: input.filters.entityType ?? null,
      p_entity_id: input.filters.entityId ?? null,
      p_action: input.filters.action ?? null,
      p_result: input.filters.result ?? null,
      p_created_from: input.filters.createdFrom ?? null,
      p_created_to: input.filters.createdTo ?? null,
      p_correlation_id: input.filters.correlationId ?? null,
    });
    if (error || !Array.isArray(data)) throw new AuditLogRepositoryError();

    const rows = z.array(auditRowSchema).safeParse(data);
    if (!rows.success) throw new AuditLogRepositoryError();
    const visible = rows.data.slice(0, input.limit);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => ({
        id: row.id,
        actor: { type: row.actor_type, id: row.actor_id, role: row.actor_role },
        action: row.action,
        entity: { type: row.entity_type, id: row.entity_id },
        result: row.result,
        summary: row.summary,
        correlationId: row.correlation_id,
        createdAt: row.created_at,
      })),
      nextCursor: rows.data.length > input.limit && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
    };
  }
}

export function createAuditLogRepository(config: {
  url: string;
  serviceRoleKey: string;
}): AuditLogRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseAuditLogRepository(client as unknown as DatabaseClient);
}
