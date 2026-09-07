import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { createFanpageHandlers, fanpageFailure } from "@/server/fanpage/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string; noticeSlug: string }> }) {
  try {
    const { slug, noticeSlug } = await context.params;
    return await createFanpageHandlers(createFanpageDependencies()).comments(request, slug, noticeSlug);
  } catch (error) { return fanpageFailure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; noticeSlug: string }> }) {
  try {
    const { slug, noticeSlug } = await context.params;
    return await createFanpageHandlers(createFanpageDependencies()).postComment(request, slug, noticeSlug);
  } catch (error) { return fanpageFailure(error); }
}
