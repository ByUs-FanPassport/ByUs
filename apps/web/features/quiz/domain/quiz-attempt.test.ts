import { describe, expect, it } from "vitest";

import {
  parseQuizAnswerInput,
  parseQuizAttemptProjection,
  parseQuizStartProjection,
  parseQuizSubmitProjection,
} from "./quiz-attempt";

const questions = [1, 2, 3].map((position) => ({
  id: `00000000-0000-4000-8000-00000000000${position}`,
  position,
  prompt: `질문 ${position}`,
  selectedOptionId: null,
  options: [1, 2].map((optionPosition) => ({
    id: `10000000-0000-4000-800${position}-00000000000${optionPosition}`,
    position: optionPosition,
    label: `보기 ${optionPosition}`,
  })),
}));

const openAttempt = {
  attempt: {
    id: "20000000-0000-4000-8000-000000000001",
    status: "open",
    score: null,
    submittedAt: null,
  },
  questions,
};

describe("quiz attempt public DTO", () => {
  it("accepts one stable three-question snapshot with admin-positioned options", () => {
    expect(parseQuizAttemptProjection(openAttempt)).toEqual(openAttempt);
    expect(parseQuizStartProjection({ kind: "attempt", ...openAttempt })).toEqual({
      kind: "attempt",
      ...openAttempt,
    });
  });

  it("accepts the existing holder branch without exposing an attempt", () => {
    expect(
      parseQuizStartProjection({
        kind: "holder",
        passportId: "30000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({
      kind: "holder",
      passportId: "30000000-0000-4000-8000-000000000001",
    });
  });

  it("requires question and option positions to remain ordered and unique", () => {
    expect(() =>
      parseQuizAttemptProjection({
        ...openAttempt,
        questions: [questions[1], questions[0], questions[2]],
      }),
    ).toThrow();
    expect(() =>
      parseQuizAttemptProjection({
        ...openAttempt,
        questions: [
          { ...questions[0], options: [questions[0].options[1], questions[0].options[0]] },
          questions[1],
          questions[2],
        ],
      }),
    ).toThrow();
  });

  it("requires a selected option to belong to its own question", () => {
    expect(() =>
      parseQuizAttemptProjection({
        ...openAttempt,
        questions: [
          { ...questions[0], selectedOptionId: questions[1].options[0].id },
          questions[1],
          questions[2],
        ],
      }),
    ).toThrow();
  });

  it.each(["is_correct", "sourceQuestionId", "appUserId", "wallet", "operationKey", "jobs"])(
    "rejects forbidden internal field %s recursively",
    (field) => {
      expect(() =>
        parseQuizAttemptProjection({
          ...openAttempt,
          questions: [
            {
              ...questions[0],
              options: [{ ...questions[0].options[0], [field]: "secret" }, questions[0].options[1]],
            },
            questions[1],
            questions[2],
          ],
        }),
      ).toThrow();
    },
  );

  it("enforces immutable terminal result consistency", () => {
    expect(
      parseQuizSubmitProjection({
        attempt: {
          id: openAttempt.attempt.id,
          status: "failed",
          score: 1,
          submittedAt: "2026-07-21T12:00:00.000Z",
        },
        issuance: null,
      }),
    ).toEqual(expect.objectContaining({ issuance: null }));

    expect(() =>
      parseQuizSubmitProjection({
        attempt: {
          id: openAttempt.attempt.id,
          status: "passed",
          score: 1,
          submittedAt: "2026-07-21T12:00:00.000Z",
        },
        issuance: null,
      }),
    ).toThrow();
  });

  it("accepts only the minimal issued pass result", () => {
    expect(
      parseQuizSubmitProjection({
        attempt: {
          id: openAttempt.attempt.id,
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
    ).toEqual(expect.objectContaining({ issuance: expect.objectContaining({ scorePoints: 1 }) }));
  });

  it("accepts the PostgreSQL UTC offset used by live submit projections", () => {
    expect(
      parseQuizSubmitProjection({
        attempt: {
          id: openAttempt.attempt.id,
          status: "passed",
          score: 3,
          submittedAt: "2026-07-21T12:00:00.000+00:00",
        },
        issuance: {
          passportId: "30000000-0000-4000-8000-000000000001",
          stampId: "40000000-0000-4000-8000-000000000001",
          scorePoints: 1,
        },
      }),
    ).toEqual(expect.objectContaining({ attempt: expect.objectContaining({ status: "passed" }) }));
  });
});

describe("quiz answer request", () => {
  it("accepts exactly questionId and selectedOptionId", () => {
    expect(
      parseQuizAnswerInput({
        questionId: questions[0].id,
        selectedOptionId: questions[0].options[0].id,
      }),
    ).toEqual({
      questionId: questions[0].id,
      selectedOptionId: questions[0].options[0].id,
    });
  });

  it.each(["appUserId", "wallet", "score", "operationKey", "payload"])(
    "rejects browser-supplied field %s",
    (field) => {
      expect(() =>
        parseQuizAnswerInput({
          questionId: questions[0].id,
          selectedOptionId: questions[0].options[0].id,
          [field]: "attacker-value",
        }),
      ).toThrow();
    },
  );
});
