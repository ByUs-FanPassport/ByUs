import "server-only";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { rsvpAttendeesSchema } from "../../features/connect/rsvp-admin";
import type { FanpageDependencies } from "../fanpage/routes";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const failure = (code: string, status: number) => Response.json({ error: { code } }, { status, headers });

export function createRsvpAdminHandler(deps: Pick<FanpageDependencies, "authorizeAdmin" | "rpc">) {
  return async (request: Request): Promise<Response> => {
    try {
      const actor = await deps.authorizeAdmin(request.headers.get("authorization"), crypto.randomUUID());
      if (request.method !== "GET") return failure("METHOD_NOT_ALLOWED", 405);
      if (new URL(request.url).search) return failure("INVALID_REQUEST", 400);
      const result = rsvpAttendeesSchema.parse(await deps.rpc("list_admin_byus_day_rsvps", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
      }));
      return Response.json(result, { headers });
    } catch (error) {
      if (error instanceof AuthError) return failure(error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", error.status === 401 ? 401 : 403);
      if (error instanceof Error && error.message === "RSVP_ADMIN_FORBIDDEN") return failure("FORBIDDEN", 403);
      return failure("RSVP_ADMIN_UNAVAILABLE", 503);
    }
  };
}
