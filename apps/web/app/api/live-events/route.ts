import { AuthError } from "@/features/auth/domain/auth-errors";
import { parseLiveLocale } from "@/features/live/domain/live-event";
import { publicContentCacheHeaders } from "@/server/cache/public-content-cache";
import { FanAuthUnavailableError } from "@/server/fan-auth/fan-auth-gate";
import {
  createLiveEventRouteDependencies,
  liveEventUnavailableResponse,
} from "@/server/g3/live-event-route-dependencies";

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = createLiveEventRouteDependencies();
    let locale;
    try {
      locale = parseLiveLocale(new URL(request.url).searchParams.get("locale") ?? "ko");
    } catch {
      return Response.json({ error: { code: "INVALID_LOCALE" } }, { status: 400 });
    }
    const authorization = request.headers.get("authorization");
    let appUserId: string | null = null;
    if (authorization) {
      try {
        appUserId = (await dependencies.authorize(authorization)).appUserId;
      } catch (error) {
        if (error instanceof FanAuthUnavailableError) return liveEventUnavailableResponse();
        if (error instanceof AuthError) {
          return Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: error.status });
        }
        return Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 });
      }
    }
    const catalog = await dependencies.repository.listPublishedCatalog({
      locale,
      appUserId,
      now: dependencies.now(),
    });
    return Response.json({ catalog }, {
      headers: appUserId
        ? { "cache-control": "private, no-store", vary: "Authorization" }
        : { ...publicContentCacheHeaders(), vary: "Authorization" },
    });
  } catch {
    return liveEventUnavailableResponse();
  }
}
