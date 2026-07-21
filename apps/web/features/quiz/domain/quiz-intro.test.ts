import { describe, expect, it } from "vitest";

import { parsePublicQuizIntro } from "./quiz-intro";

describe("public quiz intro DTO", () => {
  it.each(["available", "unavailable"] as const)(
    "accepts the fixed %s public contract",
    (availability) => {
      expect(
        parsePublicQuizIntro({
          celebrity: { slug: "kara", name: "KARA" },
          quiz: { availability, totalQuestions: 3, passThreshold: 2 },
        }),
      ).toEqual({
        celebrity: { slug: "kara", name: "KARA" },
        quiz: { availability, totalQuestions: 3, passThreshold: 2 },
      });
    },
  );

  it.each([
    { celebrity: { slug: "kara", name: "KARA" }, quiz: { availability: "available", totalQuestions: 4, passThreshold: 2 } },
    { celebrity: { slug: "kara", name: "KARA" }, quiz: { availability: "available", totalQuestions: 3, passThreshold: 1 } },
    { celebrity: { slug: "kara", name: "KARA" }, quiz: { availability: "draft", totalQuestions: 3, passThreshold: 2 } },
    { celebrity: { slug: "kara", name: "KARA" }, quiz: { availability: "available", totalQuestions: 3, passThreshold: 2 }, id: "private" },
  ])("rejects a widened or invalid projection", (value) => {
    expect(() => parsePublicQuizIntro(value)).toThrow();
  });

  it("rejects answer-bank and internal identifier fields at every public level", () => {
    expect(() =>
      parsePublicQuizIntro({
        celebrity: { slug: "kara", name: "KARA", id: "private" },
        quiz: {
          availability: "available",
          totalQuestions: 3,
          passThreshold: 2,
          questions: [{ is_correct: true }],
        },
      }),
    ).toThrow();
  });
});
