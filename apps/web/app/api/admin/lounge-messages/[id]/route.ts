import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { fanpageFailure } from "@/server/fanpage/routes";
import { createLoungeHandlers } from "@/server/lounge/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return await createLoungeHandlers(createFanpageDependencies()).adminHide(request, id);
  } catch (error) {
    return fanpageFailure(error);
  }
}
