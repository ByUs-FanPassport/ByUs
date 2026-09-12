import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { communityStampFailure, createCommunityStampHandlers } from "@/server/community-stamps/routes";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try { return await createCommunityStampHandlers(createFanpageDependencies()).action(request, (await params).action); }
  catch (error) { return communityStampFailure(error); }
}
