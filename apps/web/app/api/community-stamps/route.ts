import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { communityStampFailure, createCommunityStampHandlers } from "@/server/community-stamps/routes";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return await createCommunityStampHandlers(createFanpageDependencies()).collection(request); }
  catch (error) { return communityStampFailure(error); }
}
