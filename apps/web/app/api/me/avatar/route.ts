import {
  avatarUnavailableResponse,
  createAvatarRouteDependencies,
} from "@/server/avatar/avatar-route-dependencies";
import {
  createDeleteAvatarHandler,
  createGetAvatarHandler,
  createPatchAvatarHandler,
  createPutAvatarHandler,
} from "@/server/avatar/avatar-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    return createGetAvatarHandler(createAvatarRouteDependencies())(request);
  } catch {
    return avatarUnavailableResponse();
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    return createPutAvatarHandler(createAvatarRouteDependencies())(request);
  } catch {
    return avatarUnavailableResponse();
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    return createPatchAvatarHandler(createAvatarRouteDependencies())(request);
  } catch {
    return avatarUnavailableResponse();
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    return createDeleteAvatarHandler(createAvatarRouteDependencies())(request);
  } catch {
    return avatarUnavailableResponse();
  }
}
