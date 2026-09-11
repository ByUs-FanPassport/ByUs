import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { fanpageFailure } from "@/server/fanpage/routes";
import { createLoungeHandlers } from "@/server/lounge/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return await createLoungeHandlers(createFanpageDependencies()).adminList(request);
  } catch (error) {
    return fanpageFailure(error);
  }
}
