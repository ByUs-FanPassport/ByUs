import {
  avatarUnavailableResponse,
  createAvatarRouteDependencies,
} from "@/server/avatar/avatar-route-dependencies";
import { createImportGoogleAvatarHandler } from "@/server/avatar/avatar-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return createImportGoogleAvatarHandler(createAvatarRouteDependencies())(request);
  } catch {
    return avatarUnavailableResponse();
  }
}
