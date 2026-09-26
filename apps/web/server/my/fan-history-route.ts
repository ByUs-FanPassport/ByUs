import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { historyCursorSchema, historyKindSchema, historyPageSchema, historyRowSchema } from "@/features/my/domain/fan-history";
import type { CommunityStampDependencies } from "@/server/community-stamps/routes";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const rawPage = z.object({ items: z.array(historyRowSchema).max(30), nextCursor: historyCursorSchema.nullable() }).strict();
export function createFanHistoryHandler(deps: CommunityStampDependencies) {
  return async (request: Request) => {
    let parsingRequest = true;
    try {
      const params = new URL(request.url).searchParams;
      if (["kind", "locale", "cursor"].some(key => params.getAll(key).length > 1)) throw new z.ZodError([]);
      const kind = historyKindSchema.parse(params.get("kind") ?? "applications");
      const locale = z.enum(["ko", "en"]).parse(params.get("locale") ?? "ko");
      const encoded = params.get("cursor");
      if (encoded && (!/^[A-Za-z0-9_-]{1,500}$/.test(encoded))) throw new z.ZodError([]);
      const cursor = encoded ? historyCursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))) : null;
      parsingRequest = false;
      const owner = await deps.authorize(request.headers.get("authorization"));
      const page = rawPage.parse(await deps.rpc("get_owned_fan_history", { p_app_user_id: owner.appUserId, p_kind: kind, p_locale: locale, p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null }));
      return Response.json(historyPageSchema.parse({ items: page.items, nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString("base64url") : null }), { headers });
    } catch (error) {
      const status = error instanceof AuthError ? error.status : parsingRequest && (error instanceof z.ZodError || error instanceof SyntaxError) ? 400 : 503;
      return Response.json({ error: { code: status === 400 ? "INVALID_HISTORY_REQUEST" : status < 500 ? "AUTHENTICATION_REQUIRED" : "HISTORY_UNAVAILABLE" } }, { status, headers });
    }
  };
}
