import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { adminCorrelationId } from "./blockchain-job-route";

const resolutionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_rule") }).strict(),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("link_existing"), eventId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("distinct_events") }).strict(),
  z.object({ action: z.literal("cancel_occurrences"), eventIds: z.array(z.string().uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export const recurringReviewCommandSchema = z.object({
  revisionId: z.string().uuid(),
  expectedCurrentRevisionId: z.string().uuid().nullable(),
  resolution: resolutionSchema,
}).strict();
export type RecurringReviewCommand = z.infer<typeof recurringReviewCommandSchema>;
export interface RecurringLiveRouteDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  read(actor: { appUserId: string; allowlistId: string }): Promise<unknown>;
  resolve(actor: { appUserId: string; allowlistId: string }, input: RecurringReviewCommand, correlationId: string): Promise<unknown>;
  invalidatePublicContent(): void;
}
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
export function createRecurringLiveHandlers(deps: RecurringLiveRouteDependencies) {
  async function handle(request: Request, write: boolean) {
    const correlationId = adminCorrelationId(request);
    try {
      const session = await deps.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId });
      if (write && session.role === "viewer") return Response.json({ error: { code: "ADMIN_WRITE_REQUIRED" } }, { status: 403, headers });
      const actor = { appUserId: session.appUserId, allowlistId: session.allowlistId };
      if (!write) return Response.json(await deps.read(actor), { headers });
      let body: unknown;
      try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_RECURRING_REVIEW" } }, { status: 400, headers }); }
      const parsed = recurringReviewCommandSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: { code: "INVALID_RECURRING_REVIEW" } }, { status: 400, headers });
      const result = await deps.resolve(actor, parsed.data, correlationId);
      deps.invalidatePublicContent();
      return Response.json(result, { headers });
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: { code: error.code } }, { status: error.status, headers });
      const conflict = error instanceof Error && /CONFLICT|stale|revision mismatch/i.test(error.message);
      return Response.json({ error: { code: conflict ? "RECURRING_REVIEW_CONFLICT" : "RECURRING_SCHEDULE_UNAVAILABLE" } }, { status: conflict ? 409 : 503, headers });
    }
  }
  return { GET: (request: Request) => handle(request, false), POST: (request: Request) => handle(request, true) };
}
