import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";
import { QuizRepositoryError } from "./quiz-attempt-repository";
import {
  createGetQuizAttemptHandler,
  createSaveQuizAnswerHandler,
  createStartQuizAttemptHandler,
  createSubmitQuizAttemptHandler,
} from "./quiz-attempt-route";

const appUserId = "60000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const questionId = "00000000-0000-4000-8000-000000000001";
const optionId = "10000000-0000-4000-8001-000000000001";
const projection = {
  attempt: { id: attemptId, status: "open" as const, score: null, submittedAt: null },
  questions: [1, 2, 3].map((position) => ({
    id: `00000000-0000-4000-8000-00000000000${position}`,
    position,
    prompt: `질문 ${position}`,
    selectedOptionId: null,
    options: [1, 2].map((optionPosition) => ({
      id: `10000000-0000-4000-800${position}-00000000000${optionPosition}`,
      position: optionPosition,
      label: `보기 ${optionPosition}`,
    })),
  })),
};

function repository(overrides: Partial<QuizAttemptRepository> = {}): QuizAttemptRepository {
  return {
    start: vi.fn().mockResolvedValue({ kind: "attempt", ...projection }),
    findOwned: vi.fn().mockResolvedValue(projection),
    saveAnswer: vi.fn().mockResolvedValue(projection),
    submit: vi.fn().mockResolvedValue({
      attempt: {
        id: attemptId,
        status: "failed",
        score: 1,
        submittedAt: "2026-07-21T12:00:00.000Z",
      },
      issuance: null,
    }),
    ...overrides,
  };
}

const authorize = vi.fn().mockResolvedValue({ appUserId });
const headers = { authorization: "Bearer token" };

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

describe("authenticated quiz attempt HTTP boundary", () => {
  it("starts with an empty body and a server-generated idempotency key", async () => {
    const repo = repository();
    const handler = createStartQuizAttemptHandler({
      authorize,
      repository: repo,
      createId: () => "70000000-0000-4000-8000-000000000001",
    });
    const response = await handler(
      new Request("https://byus.kr/api/celebrities/kara/quiz/attempts?locale=ko", {
        method: "POST",
        headers,
      }),
      { celebritySlug: "kara" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(repo.start).toHaveBeenCalledWith({
      appUserId,
      celebritySlug: "kara",
      idempotencyKey: "70000000-0000-4000-8000-000000000001",
      locale: "ko",
    });
    expect(await response.json()).toEqual({ result: { kind: "attempt", ...projection } });
  });

  it("rejects any start or submit body before a mutation dependency is called", async () => {
    const repo = repository();
    const startResponse = await createStartQuizAttemptHandler({
      authorize,
      repository: repo,
      createId: crypto.randomUUID,
    })(new Request("https://byus.kr/api/celebrities/kara/quiz/attempts", {
      method: "POST",
      headers,
      body: JSON.stringify({ appUserId }),
    }), { celebritySlug: "kara" });
    const submitResponse = await createSubmitQuizAttemptHandler({ authorize, repository: repo })(
      new Request(`https://byus.kr/api/quiz-attempts/${attemptId}/submit`, {
        method: "POST",
        headers,
        body: "{}",
      }),
      { attemptId },
    );
    expect(startResponse.status).toBe(400);
    expect(submitResponse.status).toBe(400);
    expect(repo.start).not.toHaveBeenCalled();
    expect(repo.submit).not.toHaveBeenCalled();
  });

  it("reads only the authenticated owner's localized attempt", async () => {
    const repo = repository();
    const response = await createGetQuizAttemptHandler({ authorize, repository: repo })(
      new Request(`https://byus.kr/api/quiz-attempts/${attemptId}?locale=en`, { headers }),
      { attemptId },
    );
    expect(response.status).toBe(200);
    expect(repo.findOwned).toHaveBeenCalledWith({ appUserId, attemptId, locale: "en" });
    expect(await response.json()).toEqual({ attempt: projection });
  });

  it("saves exactly one strict answer selection", async () => {
    const repo = repository();
    const response = await createSaveQuizAnswerHandler({ authorize, repository: repo })(
      new Request(`https://byus.kr/api/quiz-attempts/${attemptId}/answers?locale=ko`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ questionId, selectedOptionId: optionId }),
      }),
      { attemptId },
    );
    expect(response.status).toBe(200);
    expect(repo.saveAnswer).toHaveBeenCalledWith({
      appUserId,
      attemptId,
      questionId,
      selectedOptionId: optionId,
      locale: "ko",
    });
    expect(await response.json()).toEqual({ attempt: projection });
  });

  it("returns a minimal pass result with no internal fields at any depth", async () => {
    const repo = repository({
      submit: vi.fn().mockResolvedValue({
        attempt: {
          id: attemptId,
          status: "passed",
          score: 2,
          submittedAt: "2026-07-21T12:00:00.000Z",
        },
        issuance: {
          passportId: "30000000-0000-4000-8000-000000000001",
          stampId: "40000000-0000-4000-8000-000000000001",
          scorePoints: 1,
        },
      }),
    });
    const response = await createSubmitQuizAttemptHandler({ authorize, repository: repo })(
      new Request(`https://byus.kr/api/quiz-attempts/${attemptId}/submit`, {
        method: "POST",
        headers,
      }),
      { attemptId },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      result: {
        attempt: {
          id: attemptId,
          status: "passed",
          score: 2,
          submittedAt: "2026-07-21T12:00:00.000Z",
        },
        issuance: {
          passportId: "30000000-0000-4000-8000-000000000001",
          stampId: "40000000-0000-4000-8000-000000000001",
          scorePoints: 1,
        },
      },
    });

    const keys = collectKeys(body);
    for (const forbidden of [
      "activityId",
      "appUserId",
      "sourceQuestionId",
      "sourceOptionId",
      "sourceId",
      "job",
      "jobs",
      "payload",
      "wallet",
      "isCorrect",
      "is_correct",
      "correctness",
      "operationKey",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("rejects extra answer fields and malformed resource IDs", async () => {
    const repo = repository();
    const answerResponse = await createSaveQuizAnswerHandler({ authorize, repository: repo })(
      new Request(`https://byus.kr/api/quiz-attempts/${attemptId}/answers`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ questionId, selectedOptionId: optionId, score: 3 }),
      }),
      { attemptId },
    );
    const readResponse = await createGetQuizAttemptHandler({ authorize, repository: repo })(
      new Request("https://byus.kr/api/quiz-attempts/not-a-uuid", { headers }),
      { attemptId: "not-a-uuid" },
    );
    expect(answerResponse.status).toBe(400);
    expect(readResponse.status).toBe(404);
    expect(repo.saveAnswer).not.toHaveBeenCalled();
    expect(repo.findOwned).not.toHaveBeenCalled();
  });

  it.each([
    ["QUIZ_UNAVAILABLE", 409, "QUIZ_UNAVAILABLE"],
    ["ATTEMPT_INCOMPLETE", 409, "ATTEMPT_INCOMPLETE"],
    ["ATTEMPT_CLOSED", 409, "ATTEMPT_CLOSED"],
    ["WALLET_REQUIRED", 409, "WALLET_REQUIRED"],
    ["NOT_FOUND", 404, "NOT_FOUND"],
    ["UNAVAILABLE", 503, "QUIZ_UNAVAILABLE"],
  ] as const)("maps repository %s to a stable public response", async (code, status, publicCode) => {
    const repo = repository({ submit: vi.fn().mockRejectedValue(new QuizRepositoryError(code)) });
    const response = await createSubmitQuizAttemptHandler({ authorize, repository: repo })(
      new Request(`https://byus.kr/api/quiz-attempts/${attemptId}/submit`, {
        method: "POST",
        headers,
      }),
      { attemptId },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: publicCode } });
  });

  it.each([
    [new AuthError("AUTHENTICATION_REQUIRED", 401, "private"), 401, "UNAUTHENTICATED"],
    [new AuthError("AUTHENTICATION_REQUIRED", 403, "private"), 403, "FORBIDDEN"],
  ] as const)("preserves the opaque fan-auth boundary", async (error, status, code) => {
    const response = await createGetQuizAttemptHandler({
      authorize: vi.fn().mockRejectedValue(error),
      repository: repository(),
    })(new Request(`https://byus.kr/api/quiz-attempts/${attemptId}`, { headers }), { attemptId });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });
});
