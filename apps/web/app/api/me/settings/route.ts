import { createSettingsRouteDependencies } from "../../../../server/profile/settings-route-dependencies";
import { createGetSettingsHandler } from "../../../../server/profile/settings-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return createGetSettingsHandler(createSettingsRouteDependencies())(request);
  } catch {
    return Response.json(
      { error: { code: "SETTINGS_UNAVAILABLE" } },
      {
        status: 503,
        headers: { "cache-control": "no-store", vary: "Authorization" },
      },
    );
  }
}
