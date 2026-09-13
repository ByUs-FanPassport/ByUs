import { createHomeBannerManagerDependencies } from "../../../../server/g5/home-banner-manager-route-dependencies";
import { createHomeBannerManagerHandlers } from "../../../../server/g5/home-banner-manager-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = () => createHomeBannerManagerHandlers(createHomeBannerManagerDependencies());
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
