import { collectibleUnavailableResponse, createCollectibleRouteDependencies, createGetCollectibleHandler, createPostCollectibleHandler } from "../../../../../server/collectible/collectible-route";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try { const deps = createCollectibleRouteDependencies(); const { slug } = await context.params; return createGetCollectibleHandler(deps)(request, { slug }); }
  catch { return collectibleUnavailableResponse(); }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try { const deps = createCollectibleRouteDependencies(); const { slug } = await context.params; return createPostCollectibleHandler(deps)(request, { slug }); }
  catch { return collectibleUnavailableResponse(); }
}
