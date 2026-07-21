import { createProfileRouteDependencies, profileUnavailableResponse } from "../../../../server/profile/profile-route-dependencies";
import { createGetProfileHandler } from "../../../../server/profile/profile-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return createGetProfileHandler(createProfileRouteDependencies())(request); }
  catch { return profileUnavailableResponse(); }
}

