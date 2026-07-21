import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  parseSurveyLocale,
  saveLiveSurveyDraftRequestSchema,
  submitLiveSurveyRequestSchema,
} from "../../features/live/domain/live-survey";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import {
  LiveSurveyRepositoryError,
  type LiveSurveyFailureCode,
  type LiveSurveyRepository,
} from "./live-survey-repository";

export interface LiveSurveyRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: LiveSurveyRepository;
}

const failures: Readonly<Record<LiveSurveyFailureCode, { code: string; status: number }>> = {
  SURVEY_NOT_FOUND: { code: "SURVEY_NOT_FOUND", status: 404 },
  ATTENDANCE_REQUIRED: { code: "ATTENDANCE_REQUIRED", status: 403 },
  SURVEY_ALREADY_SUBMITTED: { code: "SURVEY_ALREADY_SUBMITTED", status: 409 },
  REVISION_CONFLICT: { code: "REVISION_CONFLICT", status: 409 },
  IDEMPOTENCY_KEY_CONFLICT: { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 },
  INVALID_ANSWERS: { code: "INVALID_ANSWERS", status: 422 },
  PASSPORT_REQUIRED: { code: "PASSPORT_REQUIRED", status: 403 },
  WALLET_NOT_READY: { code: "WALLET_NOT_READY", status: 409 },
  USER_UNAVAILABLE: { code: "AUTHENTICATION_REQUIRED", status: 403 },
  SURVEY_INTEGRITY_ERROR: { code: "SURVEY_UNAVAILABLE", status: 503 },
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
}

async function authorize(dependencies: LiveSurveyRouteDependencies, request: Request): Promise<{ appUserId: string } | Response> {
  try { return await dependencies.authorize(request.headers.get("authorization")); }
  catch (error) {
    if (error instanceof FanAuthUnavailableError) return json({ error: { code: "SURVEY_UNAVAILABLE" } }, 503);
    if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
    return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  }
}

function mapError(error: unknown): Response {
  if (error instanceof LiveSurveyRepositoryError) {
    const mapped = failures[error.code];
    return json({ error: { code: mapped.code } }, mapped.status);
  }
  return json({ error: { code: "SURVEY_UNAVAILABLE" } }, 503);
}

function validSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function createGetLiveSurveyHandler(dependencies: LiveSurveyRouteDependencies) {
  return async (request: Request, input: { slug: string }): Promise<Response> => {
    if (!validSlug(input.slug)) return json({ error: { code: "SURVEY_NOT_FOUND" } }, 404);
    let locale;
    try { locale = parseSurveyLocale(new URL(request.url).searchParams.get("locale") ?? "ko"); }
    catch { return json({ error: { code: "INVALID_LOCALE" } }, 400); }
    const owner = await authorize(dependencies, request);
    if (owner instanceof Response) return owner;
    try {
      const result = await dependencies.repository.get({ appUserId: owner.appUserId, slug: input.slug, locale });
      return result ? json(result, 200) : json({ error: { code: "SURVEY_NOT_FOUND" } }, 404);
    } catch (error) { return mapError(error); }
  };
}

function createMutationHandler(dependencies: LiveSurveyRouteDependencies, operation: "saveDraft" | "submit") {
  const schema = operation === "saveDraft" ? saveLiveSurveyDraftRequestSchema : submitLiveSurveyRequestSchema;
  return async (request: Request, input: { slug: string }): Promise<Response> => {
    if (!validSlug(input.slug)) return json({ error: { code: "SURVEY_NOT_FOUND" } }, 404);
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }
    let body;
    try { body = schema.parse(await request.json()); }
    catch { return json({ error: { code: "INVALID_REQUEST" } }, 400); }
    const owner = await authorize(dependencies, request);
    if (owner instanceof Response) return owner;
    try {
      const result = operation === "saveDraft"
        ? await dependencies.repository.saveDraft({
            appUserId: owner.appUserId,
            slug: input.slug,
            idempotencyKey: body.idempotencyKey,
            expectedRevision: saveLiveSurveyDraftRequestSchema.parse(body).expectedRevision,
            answers: body.answers,
          })
        : await dependencies.repository.submit({
            appUserId: owner.appUserId,
            slug: input.slug,
            idempotencyKey: body.idempotencyKey,
            answers: body.answers,
          });
      return json(result, 200);
    } catch (error) { return mapError(error); }
  };
}

export const createPutLiveSurveyDraftHandler = (dependencies: LiveSurveyRouteDependencies) => createMutationHandler(dependencies, "saveDraft");
export const createPostLiveSurveySubmitHandler = (dependencies: LiveSurveyRouteDependencies) => createMutationHandler(dependencies, "submit");
