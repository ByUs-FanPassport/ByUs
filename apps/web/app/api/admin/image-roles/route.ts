import { createPublicImageRouteDependencies } from "../../../../server/media/public-image-dependencies";
import { createImageRoleHandlers } from "../../../../server/media/public-image-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = () => createImageRoleHandlers(createPublicImageRouteDependencies());
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
