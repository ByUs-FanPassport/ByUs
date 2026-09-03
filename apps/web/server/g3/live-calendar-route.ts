import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  liveCalendarMonthValueSchema,
} from "../../features/live/domain/live-calendar";
import { parseLiveLocale, type LiveLocale } from "../../features/live/domain/live-event";
import { publicContentCacheHeaders } from "../cache/public-content-cache";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import type { LiveCalendarRepository } from "./live-calendar-repository";

export interface LiveCalendarRouteDependencies {
  repository: LiveCalendarRepository;
  authorize(authorization: string): Promise<{ appUserId: string }>;
  now(): Date;
}

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "Authorization",
};

function errorResponse(code: string, status: number, authenticated: boolean): Response {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: authenticated
        ? privateHeaders
        : { "cache-control": "no-store", vary: "Authorization" },
    },
  );
}

function parseRequest(url: URL): { month: string; locale: LiveLocale } {
  const allowedKeys = new Set(["month", "locale"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key)) throw new Error("unexpected calendar parameter");
  }
  if (url.searchParams.getAll("month").length !== 1) {
    throw new Error("month is required exactly once");
  }
  if (url.searchParams.getAll("locale").length > 1) {
    throw new Error("locale may be supplied once");
  }
  return {
    month: liveCalendarMonthValueSchema.parse(url.searchParams.get("month")),
    locale: parseLiveLocale(url.searchParams.get("locale") ?? "ko"),
  };
}

export function createGetLiveCalendarHandler(
  dependencies: LiveCalendarRouteDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization");
    const hasAuthorization = authorization !== null;
    let query: ReturnType<typeof parseRequest>;
    try {
      query = parseRequest(new URL(request.url));
    } catch {
      return errorResponse("INVALID_CALENDAR_REQUEST", 400, hasAuthorization);
    }

    let appUserId: string | null = null;
    if (authorization !== null) {
      try {
        appUserId = (await dependencies.authorize(authorization)).appUserId;
      } catch (error) {
        if (error instanceof FanAuthUnavailableError) {
          return errorResponse("LIVE_CALENDAR_UNAVAILABLE", 503, true);
        }
        if (error instanceof AuthError) {
          return errorResponse("AUTHENTICATION_REQUIRED", error.status, true);
        }
        return errorResponse("AUTHENTICATION_REQUIRED", 401, true);
      }
    }

    try {
      const calendar = await dependencies.repository.readMonth({
        ...query,
        appUserId,
        now: dependencies.now(),
      });
      return Response.json(calendar, {
        headers: appUserId
          ? privateHeaders
          : { ...publicContentCacheHeaders(), vary: "Authorization" },
      });
    } catch {
      return errorResponse("LIVE_CALENDAR_UNAVAILABLE", 503, appUserId !== null);
    }
  };
}
