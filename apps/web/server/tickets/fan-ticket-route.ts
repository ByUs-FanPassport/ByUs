import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { fanTicketActivitySchema } from "@/features/tickets/domain/fan-ticket-activity";
import type { FanpageDependencies } from "@/server/fanpage/routes";

const headers = { "cache-control": "private, no-store", vary: "Authorization" } as const;
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const beforeSchema = z.string().regex(/^[1-9]\d*$/).refine((value) => {
  try { return BigInt(value) <= 9_007_199_254_740_991n; } catch { return false; }
});

function json(value: unknown, status = 200) { return Response.json(value, { status, headers }); }

export function createGetFanTicketsHandler(dependencies: Pick<FanpageDependencies, "authorize" | "rpc">) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.searchParams.getAll("creator").length !== 1 || url.searchParams.getAll("before").length > 1 || url.searchParams.getAll("locale").length > 1) {
        return json({ error: { code: "INVALID_REQUEST" } }, 400);
      }
      const creator = slugSchema.parse(url.searchParams.get("creator"));
      const before = url.searchParams.get("before");
      const parsedBefore = before === null ? null : beforeSchema.parse(before);
      const locale = z.enum(["ko", "en"]).parse(url.searchParams.get("locale") ?? "ko");
      const owner = await dependencies.authorize(request.headers.get("authorization"));
      const result = await dependencies.rpc("get_owned_fan_ticket_activity", {
        p_app_user_id: owner.appUserId,
        p_slug: creator,
        p_before_sequence: parsedBefore,
        p_limit: 20,
        p_locale: locale,
      });
      const parsed = fanTicketActivitySchema.safeParse(result);
      if (!parsed.success || parsed.data.creator.slug !== creator) throw new Error("INVALID_RESPONSE");
      return json(parsed.data);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      if (error instanceof z.ZodError) return json({ error: { code: "INVALID_REQUEST" } }, 400);
      return json({ error: { code: "TICKETS_UNAVAILABLE" } }, 503);
    }
  };
}
