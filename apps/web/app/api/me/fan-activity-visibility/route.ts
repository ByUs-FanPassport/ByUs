import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { createFanpageHandlers, fanpageFailure } from "@/server/fanpage/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return await createFanpageHandlers(createFanpageDependencies()).visibility(request); }
  catch (error) { return fanpageFailure(error); }
}
export const PATCH = GET;
