import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  NicknameValidationError,
  normalizeNickname,
} from "../../features/profile/domain/profile";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import {
  ProfileRepositoryError,
  type ProfileRepository,
} from "./profile-repository";

export interface ProfileRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: ProfileRepository;
}

const nicknameBodySchema = z.object({ nickname: z.string() }).strict();
const headers = { "cache-control": "no-store", vary: "Authorization" } as const;

function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers });
}

async function authorize(
  request: Request,
  dependencies: ProfileRouteDependencies,
): Promise<AuthorizedFan | Response> {
  try {
    return await dependencies.authorize(
      request.headers.get("authorization") ?? "",
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return error.status === 401
        ? failure(401, "UNAUTHENTICATED")
        : failure(403, "FORBIDDEN");
    }
    return failure(503, "PROFILE_UNAVAILABLE");
  }
}

function mapRepositoryError(error: unknown): Response {
  if (!(error instanceof ProfileRepositoryError))
    return failure(503, "PROFILE_UNAVAILABLE");
  if (
    error.code === "INVALID_NICKNAME" ||
    error.code === "NICKNAME_PROHIBITED"
  ) {
    return failure(400, error.code);
  }
  if (
    error.code === "NICKNAME_TAKEN" ||
    error.code === "PROFILE_ALREADY_COMPLETED"
  ) {
    return failure(409, error.code);
  }
  if (error.code === "USER_UNAVAILABLE") return failure(403, "FORBIDDEN");
  return failure(503, "PROFILE_UNAVAILABLE");
}

export function createGetProfileHandler(
  dependencies: ProfileRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const fan = await authorize(request, dependencies);
    if (fan instanceof Response) return fan;
    try {
      return Response.json(
        { profile: await dependencies.repository.get(fan.appUserId) },
        { headers },
      );
    } catch (error) {
      return mapRepositoryError(error);
    }
  };
}

export function createPostNicknameHandler(
  dependencies: ProfileRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const fan = await authorize(request, dependencies);
    if (fan instanceof Response) return fan;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, "INVALID_NICKNAME");
    }
    const parsed = nicknameBodySchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_NICKNAME");

    let nickname: string;
    try {
      nickname = normalizeNickname(parsed.data.nickname).nickname;
    } catch (error) {
      return failure(
        400,
        error instanceof NicknameValidationError &&
          error.reason === "prohibited"
          ? "NICKNAME_PROHIBITED"
          : "INVALID_NICKNAME",
      );
    }

    try {
      const profile = await dependencies.repository.setNickname({
        appUserId: fan.appUserId,
        nickname,
      });
      return Response.json({ profile }, { headers });
    } catch (error) {
      return mapRepositoryError(error);
    }
  };
}

export function createPutNicknameHandler(
  dependencies: ProfileRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const fan = await authorize(request, dependencies);
    if (fan instanceof Response) return fan;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, "INVALID_NICKNAME");
    }
    const parsed = nicknameBodySchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_NICKNAME");

    let nickname: string;
    try {
      nickname = normalizeNickname(parsed.data.nickname).nickname;
    } catch (error) {
      return failure(
        400,
        error instanceof NicknameValidationError &&
          error.reason === "prohibited"
          ? "NICKNAME_PROHIBITED"
          : "INVALID_NICKNAME",
      );
    }

    try {
      if (!dependencies.repository.renameNickname)
        return failure(503, "PROFILE_UNAVAILABLE");
      return Response.json(
        {
          profile: await dependencies.repository.renameNickname({
            appUserId: fan.appUserId,
            nickname,
          }),
        },
        { headers },
      );
    } catch (error) {
      return mapRepositoryError(error);
    }
  };
}
