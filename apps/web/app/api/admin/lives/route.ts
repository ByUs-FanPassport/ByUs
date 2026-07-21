import { createLiveManagerRouteDependencies } from "../../../../server/g5/live-manager-route-dependencies";
import { createGetLiveManagerHandler, createPostLiveManagerHandler } from "../../../../server/g5/live-manager-route";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return createGetLiveManagerHandler(createLiveManagerRouteDependencies())(request); }
export async function POST(request: Request) { return createPostLiveManagerHandler(createLiveManagerRouteDependencies())(request); }
