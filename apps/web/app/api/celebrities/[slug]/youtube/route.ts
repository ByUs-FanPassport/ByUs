import { z } from "zod";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";
import { readYouTubeUploads } from "@/server/youtube/youtube-uploads";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const slug = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).safeParse((await context.params).slug);
  if (!slug.success) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers });
  try {
    // Recheck publication for every request, even when the upstream videos are cached.
    const creator = await createPublishedContentRepositoryFromEnvironment().findBySlug("ko", slug.data);
    if (!creator) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers });
    const source = creator.socialLinks.find(link => link.platform === "youtube");
    const items = source ? await readYouTubeUploads(source.url) : [];
    if (items === null) throw new Error("YOUTUBE_UNAVAILABLE");
    return Response.json({ items, nextCursor: null }, { headers });
  } catch {
    return Response.json({ error: { code: "YOUTUBE_UNAVAILABLE" } }, { status: 503, headers });
  }
}
