import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  claimBenefitRequestSchema,
  parseBenefitLocale,
} from "../../features/benefit/domain/benefit";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import {
  BenefitRepositoryError,
  type BenefitRepository,
} from "./benefit-repository";
import { publicContentCacheHeaders } from "../cache/public-content-cache";

export interface BenefitRouteDependencies {
  repository: BenefitRepository;
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  now(): Date;
}

function json(body: unknown, status: number, authenticated: boolean): Response {
  return Response.json(body, {
    status,
    headers: authenticated
      ? { "cache-control": "private, no-store", vary: "Authorization" }
      : {
          ...publicContentCacheHeaders(),
          vary: "Authorization",
        },
  });
}

async function optionalOwner(
  request: Request,
  dependencies: BenefitRouteDependencies,
): Promise<{ owner: { appUserId: string } | null; failure: Response | null }> {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return { owner: null, failure: null };
  try {
    return {
      owner: await dependencies.authorize(authorization),
      failure: null,
    };
  } catch (error) {
    if (error instanceof FanAuthUnavailableError)
      return {
        owner: null,
        failure: json({ error: { code: "BENEFITS_UNAVAILABLE" } }, 503, true),
      };
    if (error instanceof AuthError)
      return {
        owner: null,
        failure: json(
          { error: { code: "AUTHENTICATION_REQUIRED" } },
          error.status,
          true,
        ),
      };
    return {
      owner: null,
      failure: json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401, true),
    };
  }
}

function parseLocale(request: Request) {
  return parseBenefitLocale(
    new URL(request.url).searchParams.get("locale") ?? "ko",
  );
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createGetBenefitsHandler(
  dependencies: BenefitRouteDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const celebrity = new URL(request.url).searchParams.get("celebrity") ?? "";
    if (!slugPattern.test(celebrity))
      return json({ error: { code: "INVALID_REQUEST" } }, 400, false);
    let locale;
    try {
      locale = parseLocale(request);
    } catch {
      return json({ error: { code: "INVALID_LOCALE" } }, 400, false);
    }
    const authentication = await optionalOwner(request, dependencies);
    if (authentication.failure) return authentication.failure;
    try {
      const result = await dependencies.repository.list({
        celebritySlug: celebrity,
        locale,
        appUserId: authentication.owner?.appUserId ?? null,
        now: dependencies.now(),
      });
      return json(result, 200, authentication.owner !== null);
    } catch {
      return json(
        { error: { code: "BENEFITS_UNAVAILABLE" } },
        503,
        authentication.owner !== null,
      );
    }
  };
}

export function createGetBenefitHandler(
  dependencies: BenefitRouteDependencies,
) {
  return async function GET(
    request: Request,
    input: { benefitId: string },
  ): Promise<Response> {
    if (!uuidPattern.test(input.benefitId))
      return json({ error: { code: "BENEFIT_NOT_FOUND" } }, 404, false);
    let locale;
    try {
      locale = parseLocale(request);
    } catch {
      return json({ error: { code: "INVALID_LOCALE" } }, 400, false);
    }
    const authentication = await optionalOwner(request, dependencies);
    if (authentication.failure) return authentication.failure;
    try {
      const result = await dependencies.repository.find({
        benefitId: input.benefitId,
        locale,
        appUserId: authentication.owner?.appUserId ?? null,
        now: dependencies.now(),
      });
      if (!result)
        return json(
          { error: { code: "BENEFIT_NOT_FOUND" } },
          404,
          authentication.owner !== null,
        );
      return json({ benefit: result }, 200, authentication.owner !== null);
    } catch {
      return json(
        { error: { code: "BENEFITS_UNAVAILABLE" } },
        503,
        authentication.owner !== null,
      );
    }
  };
}

const claimFailures = {
  BENEFIT_NOT_FOUND: ["BENEFIT_NOT_FOUND", 404],
  BENEFIT_LOCKED: ["BENEFIT_LOCKED", 403],
  BENEFIT_SOLD_OUT: ["BENEFIT_SOLD_OUT", 409],
  BENEFIT_EXPIRED: ["BENEFIT_EXPIRED", 409],
  BENEFIT_CLAIM_LIMIT_REACHED: ["BENEFIT_CLAIM_LIMIT_REACHED", 409],
  IDEMPOTENCY_KEY_CONFLICT: ["IDEMPOTENCY_KEY_CONFLICT", 409],
  BENEFIT_UNAVAILABLE: ["BENEFIT_UNAVAILABLE", 503],
} as const;

export function createPostBenefitClaimHandler(
  dependencies: BenefitRouteDependencies,
) {
  return async function POST(
    request: Request,
    input: { benefitId: string },
  ): Promise<Response> {
    if (!uuidPattern.test(input.benefitId))
      return json({ error: { code: "BENEFIT_NOT_FOUND" } }, 404, true);
    if (
      !(request.headers.get("content-type") ?? "")
        .toLowerCase()
        .startsWith("application/json")
    )
      return json({ error: { code: "INVALID_REQUEST" } }, 400, true);
    let body;
    try {
      body = claimBenefitRequestSchema.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400, true);
    }
    let owner;
    try {
      owner = await dependencies.authorize(
        request.headers.get("authorization"),
      );
    } catch (error) {
      if (error instanceof FanAuthUnavailableError)
        return json({ error: { code: "BENEFIT_UNAVAILABLE" } }, 503, true);
      if (error instanceof AuthError)
        return json(
          { error: { code: "AUTHENTICATION_REQUIRED" } },
          error.status,
          true,
        );
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401, true);
    }
    try {
      return json(
        await dependencies.repository.claim({
          benefitId: input.benefitId,
          appUserId: owner.appUserId,
          idempotencyKey: body.idempotencyKey,
          now: dependencies.now(),
        }),
        200,
        true,
      );
    } catch (error) {
      if (error instanceof BenefitRepositoryError) {
        const [code, status] = claimFailures[error.code];
        return json({ error: { code } }, status, true);
      }
      return json({ error: { code: "BENEFIT_UNAVAILABLE" } }, 503, true);
    }
  };
}

export function createPostBenefitApplicationHandler(
  dependencies: BenefitRouteDependencies,
) {
  return async function POST(
    request: Request,
    input: { benefitId: string },
  ): Promise<Response> {
    if (!uuidPattern.test(input.benefitId))
      return json({ error: { code: "BENEFIT_NOT_FOUND" } }, 404, true);
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!uuidPattern.test(idempotencyKey))
      return json({ error: { code: "INVALID_REQUEST" } }, 400, true);
    let owner;
    try {
      owner = await dependencies.authorize(
        request.headers.get("authorization"),
      );
    } catch (error) {
      if (error instanceof FanAuthUnavailableError)
        return json({ error: { code: "BENEFIT_UNAVAILABLE" } }, 503, true);
      if (error instanceof AuthError)
        return json(
          { error: { code: "AUTHENTICATION_REQUIRED" } },
          error.status,
          true,
        );
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401, true);
    }
    try {
      return json(
        await dependencies.repository.apply({
          benefitId: input.benefitId,
          appUserId: owner.appUserId,
          idempotencyKey,
          now: dependencies.now(),
        }),
        200,
        true,
      );
    } catch (error) {
      if (error instanceof BenefitRepositoryError) {
        const [code, status] = claimFailures[error.code];
        return json({ error: { code } }, status, true);
      }
      return json({ error: { code: "BENEFIT_UNAVAILABLE" } }, 503, true);
    }
  };
}

export function createGetOwnedBenefitApplicationHandler(
  dependencies: BenefitRouteDependencies,
) {
  return async function GET(
    request: Request,
    input: { benefitId: string },
  ): Promise<Response> {
    if (!uuidPattern.test(input.benefitId))
      return json({ error: { code: "BENEFIT_NOT_FOUND" } }, 404, true);
    let owner;
    try {
      owner = await dependencies.authorize(
        request.headers.get("authorization"),
      );
    } catch (error) {
      if (error instanceof FanAuthUnavailableError)
        return json({ error: { code: "BENEFIT_UNAVAILABLE" } }, 503, true);
      if (error instanceof AuthError)
        return json(
          { error: { code: "AUTHENTICATION_REQUIRED" } },
          error.status,
          true,
        );
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401, true);
    }
    try {
      const application = await dependencies.repository.application({
        benefitId: input.benefitId,
        appUserId: owner.appUserId,
      });
      if (!application)
        return json({ error: { code: "APPLICATION_NOT_FOUND" } }, 404, true);
      return json({ application }, 200, true);
    } catch {
      return json({ error: { code: "BENEFIT_UNAVAILABLE" } }, 503, true);
    }
  };
}
