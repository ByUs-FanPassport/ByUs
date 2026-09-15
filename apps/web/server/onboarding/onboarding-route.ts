import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { OnboardingRepository } from "./onboarding-repository";

export interface OnboardingRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: OnboardingRepository;
}

const emptyBodySchema = z.object({}).strict();
const headers = {
  "cache-control": "private, no-store",
  vary: "Authorization",
} as const;

function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers });
}

async function authorize(
  request: Request,
  dependencies: OnboardingRouteDependencies,
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
    return failure(503, "ONBOARDING_UNAVAILABLE");
  }
}

export function createGetOnboardingHandler(
  dependencies: OnboardingRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const fan = await authorize(request, dependencies);
    if (fan instanceof Response) return fan;

    try {
      return Response.json(
        { onboarding: await dependencies.repository.get(fan.appUserId) },
        { headers },
      );
    } catch {
      return failure(503, "ONBOARDING_UNAVAILABLE");
    }
  };
}

export function createPostOnboardingHandler(
  dependencies: OnboardingRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const fan = await authorize(request, dependencies);
    if (fan instanceof Response) return fan;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, "INVALID_REQUEST");
    }
    if (!emptyBodySchema.safeParse(body).success) {
      return failure(400, "INVALID_REQUEST");
    }

    try {
      return Response.json(
        { onboarding: await dependencies.repository.dismiss(fan.appUserId) },
        { headers },
      );
    } catch {
      return failure(503, "ONBOARDING_UNAVAILABLE");
    }
  };
}
