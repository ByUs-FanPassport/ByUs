import { createProfileRouteDependencies, profileUnavailableResponse } from "../../../../server/profile/profile-route-dependencies";
import { createPostNicknameHandler } from "../../../../server/profile/profile-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try { return createPostNicknameHandler(createProfileRouteDependencies())(request); }
  catch { return profileUnavailableResponse(); }
}
