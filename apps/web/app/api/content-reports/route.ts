import { createContentDependencies } from "@/server/fan-posts/dependencies";
import { contentFailure, createContentHandlers } from "@/server/fan-posts/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    return await createContentHandlers(createContentDependencies()).report(request);
  } catch (error) { return contentFailure(error); }
}
export const POST = handle;
