import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { createFanCommunityHandlers } from "@/server/fanpage/community-routes";
import { fanpageFailure } from "@/server/fanpage/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return await createFanCommunityHandlers(createFanpageDependencies()).cheers(request, slug);
  } catch (error) {
    return fanpageFailure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return await createFanCommunityHandlers(createFanpageDependencies()).postCheer(request, slug);
  } catch (error) {
    return fanpageFailure(error);
  }
}
