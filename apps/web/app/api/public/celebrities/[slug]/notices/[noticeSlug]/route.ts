import { publicContentCacheHeaders } from "../../../../../../../server/cache/public-content-cache";
import { loadServerEnv } from "../../../../../../../server/config/env";
import { noticeLocaleSchema } from "../../../../../../../server/notice/notice-domain";
import { createNoticeRepository } from "../../../../../../../server/notice/notice-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string; noticeSlug: string }> }) {
  try {
    const { slug, noticeSlug } = await context.params;
    const locale = noticeLocaleSchema.parse(new URL(request.url).searchParams.get("locale") ?? "ko");
    const env = loadServerEnv();
    const repository = createNoticeRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
    const notice = await repository.findPublic({ celebritySlug: slug, noticeSlug, locale });
    if (!notice) return Response.json({ error: { code: "NOTICE_NOT_FOUND" } }, { status: 404 });
    return Response.json({ notice }, { headers: publicContentCacheHeaders() });
  } catch {
    return Response.json({ error: { code: "NOTICE_UNAVAILABLE" } }, { status: 503 });
  }
}
