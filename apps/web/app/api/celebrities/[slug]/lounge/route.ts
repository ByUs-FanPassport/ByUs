import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { fanpageFailure } from "@/server/fanpage/routes";
import { createLoungeHandlers } from "@/server/lounge/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return await createLoungeHandlers(createFanpageDependencies()).read(request, slug);
  } catch (error) {
    return fanpageFailure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return await createLoungeHandlers(createFanpageDependencies()).post(request, slug);
  } catch (error) {
    return fanpageFailure(error);
  }
}
