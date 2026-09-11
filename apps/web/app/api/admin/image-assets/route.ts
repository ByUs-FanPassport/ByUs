import { createPublicImageRouteDependencies } from "../../../../server/media/public-image-dependencies";
import { createPostPublicImageAssetHandler } from "../../../../server/media/public-image-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return createPostPublicImageAssetHandler(createPublicImageRouteDependencies())(request); }
