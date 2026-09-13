import { createHomeBannerManagerDependencies } from "../../../../server/g5/home-banner-manager-route-dependencies";
import { createHomeBannerManagerHandlers } from "../../../../server/g5/home-banner-manager-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createHomeBannerManagerHandlers(createHomeBannerManagerDependencies());
export const GET = handlers.GET;
export const POST = handlers.POST;
