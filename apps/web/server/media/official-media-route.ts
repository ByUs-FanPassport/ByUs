import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { FanAuthUnavailableError } from "@/server/fan-auth/fan-auth-gate";
import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import type { FanpageDependencies } from "@/server/fanpage/routes";
import { noticeSchema } from "@/features/fan-posts/domain/content";
import { noticeMedia } from "@/features/media/domain/official-media";
import { creatorSlug, cursorSchema, contentLocale } from "@/features/schedules/domain/participation";
const officialCursorSchema = cursorSchema.extend({ pinned: z.boolean() });
function checked<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new Error("MEDIA_UNAVAILABLE"); return parsed.data; }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
export function createOfficialMediaHandler(deps: Pick<FanpageDependencies, "authorize" | "rpc">) {
  return async (request: Request, slug: string) => {
    try {
      creatorSlug.parse(slug); const url = new URL(request.url), p_locale = contentLocale.parse(url.searchParams.get("locale") ?? "ko"), encoded = url.searchParams.get("cursor");
      if (url.searchParams.getAll("locale").length > 1 || url.searchParams.getAll("cursor").length > 1) throw new SyntaxError();
      const cursor = encoded !== null ? officialCursorSchema.parse(JSON.parse(Buffer.from(z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/).parse(encoded), "base64url").toString("utf8"))) : null;
      const authorization = request.headers.get("authorization"), p_app_user_id = authorization === null ? null : (await deps.authorize(authorization)).appUserId;
      const page = checked(z.object({ notices: z.array(noticeSchema.omit({ body: true })), hasMore: z.boolean() }), await deps.rpc("read_fan_notices", { p_app_user_id, p_slug: slug, p_locale, p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null, p_limit: 10, p_before_pinned: cursor?.pinned ?? null }));
      // Every detail rechecks current membership and visibility; list authorization alone is insufficient.
      const media = await Promise.all(page.notices.map(async summary => { const raw = await deps.rpc("read_fan_notice", { p_app_user_id, p_slug: slug, p_notice_slug: summary.slug, p_locale }); return raw === null ? [] : noticeMedia(checked(noticeSchema, raw), slug); }));
      const last = page.notices.at(-1);
      return json({ items: media.flat(), nextCursor: page.hasMore && last ? Buffer.from(JSON.stringify({ at: last.publishedAt, id: last.id, pinned: last.pinned })).toString("base64url") : null });
    } catch (error) {
      if (error instanceof AuthError || error instanceof FanAuthUnavailableError) return json({ error: { code: error.code } }, error.status);
      if (error instanceof SyntaxError || error instanceof z.ZodError) return json({ error: { code: "INVALID_MEDIA_REQUEST" } }, 422);
      return json({ error: { code: "MEDIA_UNAVAILABLE" } }, 503);
    }
  };
}
export async function officialMediaRoute(request: Request, slug: string) { try { return await createOfficialMediaHandler(createFanpageDependencies())(request, slug); } catch { return json({ error: { code: "MEDIA_UNAVAILABLE" } }, 503); } }
