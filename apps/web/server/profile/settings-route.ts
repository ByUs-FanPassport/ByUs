import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { SettingsRepository } from "./settings-repository";

export interface SettingsRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: SettingsRepository;
}

const headers = { "cache-control": "no-store", vary: "Authorization" } as const;

export function createGetSettingsHandler(
  dependencies: SettingsRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    let fan: AuthorizedFan;
    try {
      fan = await dependencies.authorize(
        request.headers.get("authorization") ?? "",
      );
    } catch (error) {
      if (error instanceof AuthError)
        return Response.json(
          { error: { code: "UNAUTHENTICATED" } },
          { status: error.status === 401 ? 401 : 403, headers },
        );
      return Response.json(
        { error: { code: "SETTINGS_UNAVAILABLE" } },
        { status: 503, headers },
      );
    }
    try {
      return Response.json(
        { settings: await dependencies.repository.get(fan.appUserId) },
        { headers },
      );
    } catch (error) {
      const status =
        error instanceof Error && error.message === "PROFILE_REQUIRED"
          ? 409
          : 503;
      const code = status === 409 ? "PROFILE_REQUIRED" : "SETTINGS_UNAVAILABLE";
      return Response.json({ error: { code } }, { status, headers });
    }
  };
}
