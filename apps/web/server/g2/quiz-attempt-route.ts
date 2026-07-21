import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { parseQuizAnswerInput } from "../../features/quiz/domain/quiz-attempt";
import type { ContentLocale } from "../content/content-domain";
import { parseContentLocale, parsePublishedCelebritySlug } from "../content/content-domain";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";
import { QuizRepositoryError } from "./quiz-attempt-repository";

export interface QuizAttemptHandlerDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: QuizAttemptRepository;
}

interface StartDependencies extends QuizAttemptHandlerDependencies {
  createId?: () => string;
}

const uuidSchema = z.uuid();
const responseHeaders = { "cache-control": "no-store", vary: "Authorization" } as const;

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

function errorResponse(status: number, code: string): Response {
  return response({ error: { code } }, status);
}

function mappedFailure(error: unknown): Response {
  if (error instanceof AuthError) {
    return error.status === 401
      ? errorResponse(401, "UNAUTHENTICATED")
      : errorResponse(403, "FORBIDDEN");
  }
  if (error instanceof QuizRepositoryError) {
    switch (error.code) {
      case "QUIZ_UNAVAILABLE":
        return errorResponse(409, "QUIZ_UNAVAILABLE");
      case "ATTEMPT_INCOMPLETE":
        return errorResponse(409, "ATTEMPT_INCOMPLETE");
      case "ATTEMPT_CLOSED":
        return errorResponse(409, "ATTEMPT_CLOSED");
      case "WALLET_REQUIRED":
        return errorResponse(409, "WALLET_REQUIRED");
      case "NOT_FOUND":
        return errorResponse(404, "NOT_FOUND");
      case "UNAVAILABLE":
        return errorResponse(503, "QUIZ_UNAVAILABLE");
    }
  }
  return errorResponse(503, "QUIZ_UNAVAILABLE");
}

function localeFrom(request: Request): ContentLocale | null {
  try {
    return parseContentLocale(new URL(request.url).searchParams.get("locale") ?? "ko");
  } catch {
    return null;
  }
}

async function hasEmptyBody(request: Request): Promise<boolean> {
  try {
    return (await request.text()).length === 0;
  } catch {
    return false;
  }
}

async function authorized(
  request: Request,
  dependencies: QuizAttemptHandlerDependencies,
): Promise<AuthorizedFan> {
  return dependencies.authorize(request.headers.get("authorization") ?? "");
}

export function createStartQuizAttemptHandler(dependencies: StartDependencies) {
  return async function POST(
    request: Request,
    input: { celebritySlug: string },
  ): Promise<Response> {
    const slug = (() => {
      try {
        return parsePublishedCelebritySlug(input.celebritySlug);
      } catch {
        return null;
      }
    })();
    const locale = localeFrom(request);
    if (!slug) return errorResponse(404, "NOT_FOUND");
    if (!locale || !(await hasEmptyBody(request))) {
      return errorResponse(400, "INVALID_REQUEST");
    }

    try {
      const fan = await authorized(request, dependencies);
      const result = await dependencies.repository.start({
        appUserId: fan.appUserId,
        celebritySlug: slug,
        idempotencyKey: (dependencies.createId ?? randomUUID)(),
        locale,
      });
      return response({ result }, 200);
    } catch (error) {
      return mappedFailure(error);
    }
  };
}

export function createGetQuizAttemptHandler(dependencies: QuizAttemptHandlerDependencies) {
  return async function GET(
    request: Request,
    input: { attemptId: string },
  ): Promise<Response> {
    const parsedId = uuidSchema.safeParse(input.attemptId);
    const locale = localeFrom(request);
    if (!parsedId.success) return errorResponse(404, "NOT_FOUND");
    if (!locale) return errorResponse(400, "INVALID_REQUEST");

    try {
      const fan = await authorized(request, dependencies);
      const attempt = await dependencies.repository.findOwned({
        appUserId: fan.appUserId,
        attemptId: parsedId.data,
        locale,
      });
      if (!attempt) return errorResponse(404, "NOT_FOUND");
      return response({ attempt }, 200);
    } catch (error) {
      return mappedFailure(error);
    }
  };
}

export function createSaveQuizAnswerHandler(dependencies: QuizAttemptHandlerDependencies) {
  return async function PUT(
    request: Request,
    input: { attemptId: string },
  ): Promise<Response> {
    const parsedId = uuidSchema.safeParse(input.attemptId);
    const locale = localeFrom(request);
    if (!parsedId.success) return errorResponse(404, "NOT_FOUND");
    if (!locale) return errorResponse(400, "INVALID_REQUEST");

    let answer;
    try {
      answer = parseQuizAnswerInput(await request.json());
    } catch {
      return errorResponse(400, "INVALID_REQUEST");
    }

    try {
      const fan = await authorized(request, dependencies);
      const attempt = await dependencies.repository.saveAnswer({
        appUserId: fan.appUserId,
        attemptId: parsedId.data,
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
        locale,
      });
      return response({ attempt }, 200);
    } catch (error) {
      return mappedFailure(error);
    }
  };
}

export function createSubmitQuizAttemptHandler(dependencies: QuizAttemptHandlerDependencies) {
  return async function POST(
    request: Request,
    input: { attemptId: string },
  ): Promise<Response> {
    const parsedId = uuidSchema.safeParse(input.attemptId);
    if (!parsedId.success) return errorResponse(404, "NOT_FOUND");
    if (!(await hasEmptyBody(request))) return errorResponse(400, "INVALID_REQUEST");

    try {
      const fan = await authorized(request, dependencies);
      const result = await dependencies.repository.submit({
        appUserId: fan.appUserId,
        attemptId: parsedId.data,
      });
      return response({ result }, 200);
    } catch (error) {
      return mappedFailure(error);
    }
  };
}
