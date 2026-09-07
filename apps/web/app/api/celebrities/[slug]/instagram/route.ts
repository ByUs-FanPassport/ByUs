import { z } from "zod";
import { createInstagramDependencies } from "../../../../../server/instagram/dependencies";
import { privateHeaders } from "../../../../../server/instagram/pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const parsed = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).safeParse((await context.params).slug);
  if (!parsed.success) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: privateHeaders });
  try {
    const media = await createInstagramDependencies().readMedia(parsed.data);
    return media ? Response.json(media, { headers: privateHeaders })
      : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: privateHeaders });
  } catch {
    return Response.json({ items: [], updatedAt: null, error: { code: "INSTAGRAM_UNAVAILABLE" } }, { status: 503, headers: privateHeaders });
  }
}
