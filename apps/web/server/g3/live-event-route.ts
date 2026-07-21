import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { parseLiveLocale } from "../../features/live/domain/live-event";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import type { LiveEventRepository } from "./live-event-repository";
import { publicContentCacheHeaders } from "../cache/public-content-cache";

export interface LiveEventRouteDependencies {
  repository: LiveEventRepository;
  authorize(authorization: string): Promise<{ appUserId: string }>;
  now(): Date;
}

function response(
  code: string,
  status: number,
  authenticated = false,
): Response {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: authenticated
        ? { "cache-control": "private, no-store", vary: "Authorization" }
        : {
            ...publicContentCacheHeaders(),
            vary: "Authorization",
          },
    },
  );
}

export function createGetLiveEventHandler(
  dependencies: LiveEventRouteDependencies,
) {
  return async function GET(
    request: Request,
    input: { slug: string },
  ): Promise<Response> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      return response("LIVE_NOT_FOUND", 404);
    }

    let locale;
    try {
      locale = parseLiveLocale(
        new URL(request.url).searchParams.get("locale") ?? "ko",
      );
    } catch {
      return response("INVALID_LOCALE", 400);
    }

    const authorization = request.headers.get("authorization");
    let appUserId: string | null = null;
    if (authorization !== null) {
      try {
        appUserId = (await dependencies.authorize(authorization)).appUserId;
      } catch (error) {
        if (error instanceof FanAuthUnavailableError) {
          return response("LIVE_UNAVAILABLE", 503, true);
        }
        if (error instanceof AuthError) {
          return response("AUTHENTICATION_REQUIRED", error.status, true);
        }
        return response("AUTHENTICATION_REQUIRED", 401, true);
      }
    }

    try {
      const result = await dependencies.repository.findPublishedBySlug({
        slug: input.slug,
        locale,
        appUserId,
        now: dependencies.now(),
      });
      if (!result) return response("LIVE_NOT_FOUND", 404, appUserId !== null);
      return Response.json(result, {
        status: 200,
        headers: appUserId
          ? { "cache-control": "private, no-store", vary: "Authorization" }
          : {
              ...publicContentCacheHeaders(),
              vary: "Authorization",
            },
      });
    } catch {
      return response("LIVE_UNAVAILABLE", 503, appUserId !== null);
    }
  };
}
