import { publicContentCacheHeaders } from "../../../../../../server/cache/public-content-cache";
import { loadServerEnv } from "../../../../../../server/config/env";
import { noticeLocaleSchema } from "../../../../../../server/notice/notice-domain";
import { createNoticeRepository } from "../../../../../../server/notice/notice-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const url = new URL(request.url);
    const locale = noticeLocaleSchema.parse(url.searchParams.get("locale") ?? "ko");
    const env = loadServerEnv();
    const repository = createNoticeRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
    const result = await repository.listPublic({
      celebritySlug: slug,
      locale,
      cursor: url.searchParams.get("cursor"),
    });
    return Response.json(result, { headers: publicContentCacheHeaders() });
  } catch {
    return Response.json({ error: { code: "NOTICE_UNAVAILABLE" } }, { status: 503 });
  }
}
