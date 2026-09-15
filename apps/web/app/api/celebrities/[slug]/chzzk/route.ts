import { chzzkChannelId } from "@/features/fanpage/domain/chzzk-posts";
import { readChzzkPage } from "@/server/chzzk/community";
import { createPublishedContentRepositoryFromEnvironment, type PublishedContentRepository } from "@/server/content/published-content-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export function createChzzkHandler(repository: Pick<PublishedContentRepository, "findBySlug">, readPosts = readChzzkPage) {
  return async (request: Request, context: { params: Promise<{ slug: string }> }) => {
    const { slug } = await context.params;
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor !== null && !/^(0|[1-9]\d{0,8})$/.test(cursor)) return Response.json({ error: "invalid_cursor" }, { status: 400, headers });
    try {
      const creator = await repository.findBySlug("ko", slug);
      const channelId = creator ? chzzkChannelId(creator.socialLinks) : null;
      if (!channelId) {
        return Response.json({ error: "not_found" }, { status: 404, headers });
      }
      return Response.json(await readPosts(channelId, cursor), { headers });
    } catch {
      return Response.json({ error: "chzzk_unavailable" }, { status: 503, headers });
    }
  };
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    return await createChzzkHandler(createPublishedContentRepositoryFromEnvironment())(request, context);
  } catch {
    return Response.json({ error: "chzzk_unavailable" }, { status: 503, headers });
  }
}
