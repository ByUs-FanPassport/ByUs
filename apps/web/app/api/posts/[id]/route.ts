import { createContentDependencies } from "@/server/fan-posts/dependencies";
import { contentFailure, createContentHandlers } from "@/server/fan-posts/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    return await createContentHandlers(createContentDependencies()).post(request, params.id);
  } catch (error) { return contentFailure(error); }
}
export const GET = handle;
export const PATCH = handle;
export const DELETE = handle;
