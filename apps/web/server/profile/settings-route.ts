import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { preferredLocaleSchema } from "../../features/profile/domain/preferred-locale";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { SettingsRepository } from "./settings-repository";

export interface SettingsRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: SettingsRepository;
}

const headers = { "cache-control": "no-store", vary: "Authorization" } as const;
const patchSettingsSchema = z
  .object({ preferredLocale: preferredLocaleSchema })
  .strict();

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

export function createPatchSettingsHandler(
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

    let locale: "ko" | "en";
    try {
      locale = patchSettingsSchema.parse(await request.json()).preferredLocale;
    } catch {
      return Response.json(
        { error: { code: "INVALID_SETTINGS" } },
        { status: 400, headers },
      );
    }

    try {
      const preferredLocale = await dependencies.repository.setPreferredLocale(
        fan.appUserId,
        locale,
      );
      return Response.json(
        { settings: { preferredLocale } },
        { headers },
      );
    } catch {
      return Response.json(
        { error: { code: "SETTINGS_UNAVAILABLE" } },
        { status: 503, headers },
      );
    }
  };
}
