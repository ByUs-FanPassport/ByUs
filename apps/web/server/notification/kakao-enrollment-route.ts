import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import { KAKAO_ALIMTALK_CONSENT_VERSION, type SupabaseKakaoPhoneEnrollmentRepository } from "./kakao-phone-enrollment";

export interface KakaoEnrollmentRouteDependencies {
  authorize(value: string): Promise<AuthorizedFan>;
  repository: SupabaseKakaoPhoneEnrollmentRepository;
  enabled: boolean;
}

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function owner(request: Request, dependencies: KakaoEnrollmentRouteDependencies) {
  try { return await dependencies.authorize(request.headers.get("authorization") ?? ""); }
  catch (error) {
    if (error instanceof AuthError) throw error;
    throw new Error("Kakao enrollment authorization failed");
  }
}

export function createConfirmKakaoEnrollmentHandler(dependencies: KakaoEnrollmentRouteDependencies) {
  return async (request: Request) => {
    if (!dependencies.enabled) return response({ error: { code: "KAKAO_ENROLLMENT_UNAVAILABLE" } }, 503);
    try {
      const authorized = await owner(request, dependencies);
      const body = await request.json() as { enrollmentId?: unknown; consented?: unknown; consentVersion?: unknown };
      if (typeof body.enrollmentId !== "string" || body.consented !== true || body.consentVersion !== KAKAO_ALIMTALK_CONSENT_VERSION)
        return response({ error: { code: "INVALID_REQUEST" } }, 400);
      const channel = await dependencies.repository.confirm({ appUserId: authorized.appUserId, enrollmentId: body.enrollmentId, consentVersion: body.consentVersion });
      return response({ channel });
    } catch (error) {
      if (error instanceof AuthError) return response({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
      return response({ error: { code: "KAKAO_ENROLLMENT_CONFIRM_FAILED" } }, 400);
    }
  };
}

export function createCancelKakaoEnrollmentHandler(dependencies: KakaoEnrollmentRouteDependencies) {
  return async (request: Request) => {
    if (!dependencies.enabled) return response({ error: { code: "KAKAO_ENROLLMENT_UNAVAILABLE" } }, 503);
    try {
      const authorized = await owner(request, dependencies);
      await dependencies.repository.cancel(authorized.appUserId);
      return new Response(null, { status: 204, headers });
    } catch (error) {
      if (error instanceof AuthError) return response({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
      return response({ error: { code: "KAKAO_ENROLLMENT_CANCEL_FAILED" } }, 503);
    }
  };
}
