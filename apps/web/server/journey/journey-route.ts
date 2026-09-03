import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { evaluateJourneyRequestSchema } from "../../features/journey/domain/journey";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import {
  authorizeFanRequest,
  FanAuthUnavailableError,
} from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import {
  createJourneyRepositoryFromEnvironment,
  JourneyRepositoryError,
  type JourneyRpcClient,
  type JourneyRepository,
  type JourneyRepositoryFailureCode,
} from "./journey-repository";

const liveSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const responseHeaders = {
  "cache-control": "private, no-store",
  vary: "Authorization",
} as const;
const maxEvaluationBodyBytes = 4096;

export interface JourneyRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: JourneyRepository;
}

const repositoryFailureResponses: Readonly<
  Record<JourneyRepositoryFailureCode, { status: number; code: string }>
> = {
  JOURNEY_NOT_FOUND: { status: 404, code: "JOURNEY_NOT_FOUND" },
  IDEMPOTENCY_CONFLICT: { status: 409, code: "IDEMPOTENCY_CONFLICT" },
  JOURNEY_UNAVAILABLE: { status: 503, code: "JOURNEY_UNAVAILABLE" },
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

async function authorize(
  dependencies: JourneyRouteDependencies,
  request: Request,
): Promise<{ appUserId: string } | Response> {
  try {
    return await dependencies.authorize(request.headers.get("authorization"));
  } catch (error) {
    if (error instanceof AuthError) {
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
    }
    if (error instanceof FanAuthUnavailableError) {
      return json({ error: { code: "JOURNEY_UNAVAILABLE" } }, 503);
    }
    return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  }
}

function mapRepositoryFailure(error: unknown): Response {
  if (!(error instanceof JourneyRepositoryError)) {
    return json({ error: { code: "JOURNEY_UNAVAILABLE" } }, 503);
  }
  const failure = repositoryFailureResponses[error.code];
  return json({ error: { code: failure.code } }, failure.status);
}

function isJsonContentType(value: string | null): boolean {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxEvaluationBodyBytes) {
    throw new Error("request body too large");
  }
  if (!request.body) throw new Error("request body is required");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxEvaluationBodyBytes) {
      await reader.cancel();
      throw new Error("request body too large");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return JSON.parse(parts.join(""));
}

export function createGetJourneyHandler(
  dependencies: JourneyRouteDependencies,
) {
  return async function GET(
    request: Request,
    input: { slug: string },
  ): Promise<Response> {
    const slug = liveSlugSchema.safeParse(input.slug);
    if (!slug.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);

    const owner = await authorize(dependencies, request);
    if (owner instanceof Response) return owner;

    try {
      return json(
        await dependencies.repository.getOwned({
          appUserId: owner.appUserId,
          liveSlug: slug.data,
        }),
        200,
      );
    } catch (error) {
      return mapRepositoryFailure(error);
    }
  };
}

export function createPostJourneyHandler(
  dependencies: JourneyRouteDependencies,
) {
  return async function POST(
    request: Request,
    input: { slug: string },
  ): Promise<Response> {
    const slug = liveSlugSchema.safeParse(input.slug);
    if (!slug.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);

    const owner = await authorize(dependencies, request);
    if (owner instanceof Response) return owner;

    if (!isJsonContentType(request.headers.get("content-type"))) {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    let body;
    try {
      body = evaluateJourneyRequestSchema.parse(await readLimitedJson(request));
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    try {
      return json(
        await dependencies.repository.evaluateOwned({
          appUserId: owner.appUserId,
          liveSlug: slug.data,
          idempotencyKey: body.idempotencyKey,
        }),
        200,
      );
    } catch (error) {
      return mapRepositoryFailure(error);
    }
  };
}

export function createJourneyRouteDependencies(): JourneyRouteDependencies {
  const environment = loadServerEnv();
  const database = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const verifier = createPrivyNodeAccessVerifier({
    appId: environment.PRIVY_APP_ID,
    appSecret: environment.PRIVY_APP_SECRET,
    appEnvironment: environment.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
  });
  const fanRepository = createSupabaseFanAuthRepository(
    {
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    },
    database,
  );

  return {
    authorize: (authorization) =>
      authorizeFanRequest({
        authorization,
        verifier,
        repository: fanRepository,
      }),
    repository: createJourneyRepositoryFromEnvironment({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    }, database as unknown as JourneyRpcClient),
  };
}

export function journeyUnavailableResponse(): Response {
  return json({ error: { code: "JOURNEY_UNAVAILABLE" } }, 503);
}
