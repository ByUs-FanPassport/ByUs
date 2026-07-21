import "server-only";

import { z } from "zod";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type {
  IssuanceLocale,
  PassportIssuanceRepository,
} from "./passport-issuance-repository";

interface Dependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: PassportIssuanceRepository;
}

const passportIdSchema = z.uuid();
const responseHeaders = { "cache-control": "no-store", vary: "Authorization" } as const;

function errorResponse(status: 401 | 403 | 404 | 503, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: responseHeaders });
}

function localeFrom(request: Request): IssuanceLocale | null {
  const locale = new URL(request.url).searchParams.get("locale") ?? "ko";
  return locale === "ko" || locale === "en" ? locale : null;
}

export function createPassportIssuanceHandler(dependencies: Dependencies) {
  return async function GET(
    request: Request,
    input: { passportId: string },
  ): Promise<Response> {
    const parsedId = passportIdSchema.safeParse(input.passportId);
    const locale = localeFrom(request);
    if (!parsedId.success || !locale) return errorResponse(404, "NOT_FOUND");

    try {
      const fan = await dependencies.authorize(request.headers.get("authorization") ?? "");
      const issuance = await dependencies.repository.findOwnedIssuance({
        passportId: parsedId.data,
        ownerAppUserId: fan.appUserId,
        locale,
      });
      if (!issuance) return errorResponse(404, "NOT_FOUND");
      return Response.json({ issuance }, { status: 200, headers: responseHeaders });
    } catch (error) {
      if (error instanceof AuthError) {
        return error.status === 401
          ? errorResponse(401, "UNAUTHENTICATED")
          : errorResponse(403, "FORBIDDEN");
      }
      return errorResponse(503, "ISSUANCE_UNAVAILABLE");
    }
  };
}
