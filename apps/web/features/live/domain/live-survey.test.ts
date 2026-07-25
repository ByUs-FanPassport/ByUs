import { describe, expect, it } from "vitest";

import {
  parseSurveyLocale,
  projectLiveSurvey,
  projectSubmittedSurvey,
  saveLiveSurveyDraftRequestSchema,
  submitLiveSurveyRequestSchema,
} from "./live-survey";

const key = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const passportId = "44444444-4444-4444-8444-444444444444";
const stampId = "55555555-5555-4555-8555-555555555555";
const activityId = "66666666-6666-4666-8666-666666666666";
const submittedAt = "2026-07-21T12:00:00.000Z";
const completion = {
  passportId,
  earnedStamp: {
    id: stampId,
    type: "survey",
    issuedAt: submittedAt,
    businessStatus: "issued",
    mintStatus: "queued",
  },
  scoreDelta: 2,
  updatedScore: 10,
  updatedLevel: "Gold",
  leveledUp: true,
};

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

  it("requires the authoritative completion on a submitted survey projection", () => {
    const result = {
      survey: { id: key, version: 1, questions: [] },
      eligibility: { completedAttendance: true },
      response: {
        status: "submitted",
        revision: 1,
        answers: [],
        submittedAt,
      },
      completion,
    };

    expect(projectLiveSurvey(result).completion).toEqual(completion);
    expect(() => projectLiveSurvey({ ...result, completion: null })).toThrow();
  });

  it("rejects a submit response whose Stamp and completion disagree", () => {
    const result = {
      response: {
        status: "submitted",
        submittedAt,
        activityId,
        scorePoints: 2,
        stamp: {
          id: stampId,
          businessStatus: "issued",
          mintStatus: "queued",
        },
      },
      completion,
    };

    expect(projectSubmittedSurvey(result).completion).toEqual(completion);
    expect(() => projectSubmittedSurvey({
      ...result,
      completion: {
        ...completion,
        earnedStamp: { ...completion.earnedStamp, id: activityId },
      },
    })).toThrow();
  });
});
