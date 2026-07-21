import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SurveyBuilderRouteDependencies } from "./survey-builder-route";
import {
  createGetSurveyBuilderHandler,
  createWriteSurveyBuilderHandler,
} from "./survey-builder-route";
import { SurveyBuilderRepositoryError } from "./survey-builder-repository";

const id = "11111111-1111-4111-8111-111111111111";
const allowlist = "22222222-2222-4222-8222-222222222222";
const live = "33333333-3333-4333-8333-333333333333";
const document = {
  liveEvent: { id: live, slug: "test-live", status: "published" },
  versions: [],
};
const questions = [
  {
    type: "rating_1_5",
    commonKey: "overall_satisfaction",
    required: true,
    position: 1,
    text: { ko: "만족도", en: "Satisfaction" },
    options: [],
  },
  {
    type: "single_choice",
    commonKey: "purchase_intent",
    required: true,
    position: 2,
    text: { ko: "구매", en: "Purchase" },
    options: [
      { position: 1, label: { ko: "예", en: "Yes" } },
      { position: 2, label: { ko: "아니요", en: "No" } },
    ],
  },
  {
    type: "single_choice",
    commonKey: "future_interest",
    required: true,
    position: 3,
    text: { ko: "다음", en: "Future" },
    options: [
      { position: 1, label: { ko: "예", en: "Yes" } },
      { position: 2, label: { ko: "아니요", en: "No" } },
    ],
  },
  {
    type: "free_text",
    commonKey: "free_comment",
    required: false,
    position: 4,
    text: { ko: "의견", en: "Comment" },
    options: [],
  },
];
function deps(
  role: "admin" | "operator" | "viewer" = "admin",
): SurveyBuilderRouteDependencies {
  return {
    authorize: vi.fn().mockResolvedValue({
      email: "admin@example.com",
      role,
      appUserId: id,
      allowlistId: allowlist,
    }),
    repository: {
      get: vi.fn().mockResolvedValue(document),
      write: vi.fn().mockResolvedValue(document),
    },
  };
}
describe("survey builder admin route", () => {
  it("returns the response-free CMS projection to viewers", async () => {
    const d = deps("viewer");
    const response = await createGetSurveyBuilderHandler(d)(
      new Request("http://x", { headers: { authorization: "Bearer token" } }),
      { liveEventId: live },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: document });
    expect(d.repository.get).toHaveBeenCalledWith({
      actorAppUserId: id,
      actorAllowlistId: allowlist,
      liveEventId: live,
    });
  });
  it("denies viewer mutations before repository access", async () => {
    const d = deps("viewer");
    const response = await createWriteSurveyBuilderHandler(d)(
      new Request("http://x", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "create" }),
      }),
      { liveEventId: live },
    );
    expect(response.status).toBe(403);
    expect(d.repository.write).not.toHaveBeenCalled();
  });
  it("rejects malformed question graphs", async () => {
    const d = deps();
    const response = await createWriteSurveyBuilderHandler(d)(
      new Request("http://x", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "edit", surveyId: id, questions: [] }),
      }),
      { liveEventId: live },
    );
    expect(response.status).toBe(400);
    expect(d.repository.write).not.toHaveBeenCalled();
  });
  it("requires the exact canonical schema and expected draft revision", async () => {
    const d = deps();
    const invalid = questions.map((question, index) =>
      index === 0 ? { ...question, required: false } : question,
    );
    const response = await createWriteSurveyBuilderHandler(d)(
      new Request("http://x", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "edit",
          surveyId: id,
          expectedRevision: 3,
          questions: invalid,
        }),
      }),
      { liveEventId: live },
    );
    expect(response.status).toBe(400);
    expect(d.repository.write).not.toHaveBeenCalled();
  });
  it("rejects non-contiguous option positions", async () => {
    const d = deps();
    const invalid = questions.map((question, index) =>
      index === 1
        ? {
            ...question,
            options: question.options.map((option, optionIndex) =>
              optionIndex === 1 ? { ...option, position: 3 } : option,
            ),
          }
        : question,
    );
    const response = await createWriteSurveyBuilderHandler(d)(
      new Request("http://x", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "edit",
          surveyId: id,
          expectedRevision: 3,
          questions: invalid,
        }),
      }),
      { liveEventId: live },
    );
    expect(response.status).toBe(400);
    expect(d.repository.write).not.toHaveBeenCalled();
  });
  it("passes expectedRevision for an edit and maps stale conflicts to 409", async () => {
    const d = deps();
    d.repository.write = vi
      .fn()
      .mockRejectedValue(new SurveyBuilderRepositoryError("CONFLICT"));
    const response = await createWriteSurveyBuilderHandler(d)(
      new Request("http://x", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "edit",
          surveyId: id,
          expectedRevision: 3,
          questions,
        }),
      }),
      { liveEventId: live },
    );
    expect(response.status).toBe(409);
    expect(d.repository.write).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "edit",
        payload: { surveyId: id, expectedRevision: 3, questions },
      }),
    );
  });
  it("passes a safe correlation id and validated publish command", async () => {
    const d = deps("operator");
    const response = await createWriteSurveyBuilderHandler(d)(
      new Request("http://x", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "x-correlation-id": allowlist,
        },
        body: JSON.stringify({
          command: "publish",
          surveyId: id,
          expectedRevision: 4,
        }),
      }),
      { liveEventId: live },
    );
    expect(response.status).toBe(200);
    expect(d.repository.write).toHaveBeenCalledWith({
      actorAppUserId: id,
      actorAllowlistId: allowlist,
      liveEventId: live,
      command: "publish",
      payload: { surveyId: id, expectedRevision: 4 },
      correlationId: allowlist,
    });
  });
  it.each(["publish", "archive"] as const)(
    "maps stale %s intent to 409",
    async (command) => {
      const d = deps();
      d.repository.write = vi
        .fn()
        .mockRejectedValue(new SurveyBuilderRepositoryError("CONFLICT"));
      const response = await createWriteSurveyBuilderHandler(d)(
        new Request("http://x", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ command, surveyId: id, expectedRevision: 7 }),
        }),
        { liveEventId: live },
      );
      expect(response.status).toBe(409);
      expect(d.repository.write).toHaveBeenCalledWith(
        expect.objectContaining({
          command,
          payload: { surveyId: id, expectedRevision: 7 },
        }),
      );
    },
  );
});
