import {
  avatarUnavailableResponse,
  createAvatarRouteDependencies,
} from "@/server/avatar/avatar-route-dependencies";
import { createGetAvatarImageHandler } from "@/server/avatar/avatar-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    return createGetAvatarImageHandler(createAvatarRouteDependencies())(request);
  } catch {
    return avatarUnavailableResponse();
  }
}
