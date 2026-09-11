import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { NotificationMonitorError, type NotificationDeliveryCursor, type NotificationDeliveryStatus, type NotificationMonitorRepository } from "./notification-monitor-repository";

export interface NotificationMonitorRouteDependencies {
  repository: NotificationMonitorRepository;
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set(["pending", "processing", "sent", "failed"]);
const queryKeys = new Set(["status", "limit", "cursor"]);
const response = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });

async function auth(request: Request, dependencies: NotificationMonitorRouteDependencies, correlationId: string) {
  try { return await dependencies.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId }); }
  catch (error) {
    if (error instanceof AuthError) return response({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
    return response({ error: { code: "NOTIFICATION_DELIVERIES_UNAVAILABLE" } }, 503);
  }
}

function decodeCursor(value: string): NotificationDeliveryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).length !== 2 || typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || !uuid.test(parsed.id)) throw new Error();
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { throw new Error("INVALID_CURSOR"); }
}

function encodeCursor(value: NotificationDeliveryCursor | null): string | null {
  return value ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url") : null;
}

export function createGetNotificationDeliveriesHandler(dependencies: NotificationMonitorRouteDependencies) {
  return async (request: Request) => {
    const correlationId = crypto.randomUUID();
    const admin = await auth(request, dependencies, correlationId);
    if (admin instanceof Response) return admin;
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!queryKeys.has(key) || params.getAll(key).length !== 1) return response({ error: { code: "INVALID_REQUEST" } }, 400);
    const selectedStatus = params.get("status");
    const limit = Number(params.get("limit") ?? 50);
    const cursorValue = params.get("cursor");
    if ((selectedStatus && !statuses.has(selectedStatus)) || !Number.isInteger(limit) || limit < 1 || limit > 100) return response({ error: { code: "INVALID_REQUEST" } }, 400);
    let cursor: NotificationDeliveryCursor | undefined;
    try { cursor = cursorValue ? decodeCursor(cursorValue) : undefined; }
    catch { return response({ error: { code: "INVALID_REQUEST" } }, 400); }
    try {
      const page = await dependencies.repository.list({ actor: { appUserId: admin.appUserId, allowlistId: admin.allowlistId }, status: selectedStatus as NotificationDeliveryStatus | null, limit, cursor });
      return response({ ...page, nextCursor: encodeCursor(page.nextCursor) }, 200);
    } catch { return response({ error: { code: "NOTIFICATION_DELIVERIES_UNAVAILABLE" } }, 503); }
  };
}

export function createRetryNotificationDeliveryHandler(dependencies: NotificationMonitorRouteDependencies) {
  return async (request: Request, input: { id: string }) => {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    const admin = await auth(request, dependencies, correlationId);
    if (admin instanceof Response) return admin;
    if (!uuid.test(input.id)) return response({ error: { code: "NOTIFICATION_DELIVERY_NOT_FOUND" } }, 404);
    if (admin.role === "viewer") return response({ error: { code: "FORBIDDEN" } }, 403);
    const key = request.headers.get("idempotency-key");
    if (!key || !uuid.test(key) || !uuid.test(correlationId)) return response({ error: { code: "INVALID_REQUEST" } }, 400);
    try {
      return response({ delivery: await dependencies.repository.retry({ actor: { appUserId: admin.appUserId, allowlistId: admin.allowlistId }, deliveryId: input.id, idempotencyKey: key, correlationId, now: new Date() }) }, 202);
    } catch (error) {
      if (error instanceof NotificationMonitorError) {
        if (error.code === "FORBIDDEN") return response({ error: { code: "FORBIDDEN" } }, 403);
        if (error.code === "NOT_RETRYABLE") return response({ error: { code: "NOTIFICATION_DELIVERY_NOT_RETRYABLE" } }, 409);
      }
      return response({ error: { code: "NOTIFICATION_DELIVERIES_UNAVAILABLE" } }, 503);
    }
  };
}
