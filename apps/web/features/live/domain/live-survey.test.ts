import { describe, expect, it } from "vitest";

import {
  parseSurveyLocale,
  saveLiveSurveyDraftRequestSchema,
  submitLiveSurveyRequestSchema,
} from "./live-survey";

const key = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";

describe("live survey contract", () => {
  it("supports only the confirmed locales", () => {
    expect(parseSurveyLocale("ko")).toBe("ko");
    expect(parseSurveyLocale("en")).toBe("en");
    expect(() => parseSurveyLocale("ja")).toThrow();
  });

  it.each([
    { questionId, selectedOptionIds: [optionId] },
    { questionId, rating: 5 },
    { questionId, freeText: "좋았어요" },
  ])("accepts one canonical answer representation", (answer) => {
    expect(saveLiveSurveyDraftRequestSchema.parse({ idempotencyKey: key, expectedRevision: 0, answers: [answer] })).toBeTruthy();
    expect(submitLiveSurveyRequestSchema.parse({ idempotencyKey: key, answers: [answer] })).toBeTruthy();
  });

  it.each([
    { questionId },
    { questionId, rating: 5, freeText: "mixed" },
    { questionId, selectedOptionIds: [optionId, optionId] },
    { questionId, rating: 6 },
  ])("rejects ambiguous or invalid answers", (answer) => {
    expect(() => saveLiveSurveyDraftRequestSchema.parse({ idempotencyKey: key, expectedRevision: 0, answers: [answer] })).toThrow();
  });
});
