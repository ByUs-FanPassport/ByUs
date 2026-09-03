import "server-only";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import type { RecipientPurgeMonitorRepository } from "./recipient-purge-monitor-repository";
export interface RecipientPurgeMonitorRouteDependencies {
  repository: RecipientPurgeMonitorRepository;
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  now(): Date;
}
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
export function createGetRecipientPurgeStatusHandler(d: RecipientPurgeMonitorRouteDependencies) {
  return async (request: Request) => {
    const correlationId = crypto.randomUUID();
    try {
      const admin = await d.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId });
      return json(await d.repository.read({ appUserId: admin.appUserId, allowlistId: admin.allowlistId, asOf: d.now() }), 200);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
      return json({ error: { code: "RECIPIENT_PURGE_STATUS_UNAVAILABLE" } }, 503);
    }
  };
}
