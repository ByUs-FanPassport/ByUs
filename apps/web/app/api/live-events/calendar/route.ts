import { createLiveCalendarRouteDependencies } from "@/server/g3/live-calendar-route-dependencies";
import { createGetLiveCalendarHandler } from "@/server/g3/live-calendar-route";

export async function GET(request: Request): Promise<Response> {
  try {
    return await createGetLiveCalendarHandler(
      createLiveCalendarRouteDependencies(),
    )(request);
  } catch {
    return Response.json(
      { error: { code: "LIVE_CALENDAR_UNAVAILABLE" } },
      {
        status: 503,
        headers: { "cache-control": "no-store", vary: "Authorization" },
      },
    );
  }
}
