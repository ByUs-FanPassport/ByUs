import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { LiveSurveyRepositoryError } from "./live-survey-repository";
import {
  createGetLiveSurveyHandler,
  createPostLiveSurveySubmitHandler,
  createPutLiveSurveyDraftHandler,
} from "./live-survey-route";

const key = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const answers = [{ questionId, rating: 5 }];

function request(method: string, body?: unknown): Request {
  return new Request("https://byus.example/api/live-events/kara-live/survey?locale=ko", {
    method,
    headers: { authorization: "Bearer token", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("live survey handlers", () => {
  it("returns the localized owner projection without public caching", async () => {
    const result = { survey: { id: key, version: 1, questions: [] }, eligibility: { completedAttendance: true }, response: null };
    const get = vi.fn().mockResolvedValue(result);
    const run = createGetLiveSurveyHandler({ authorize: async () => ({ appUserId: "owner" }), repository: { get, saveDraft: vi.fn(), submit: vi.fn() } });
    const response = await run(request("GET"), { slug: "kara-live" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(get).toHaveBeenCalledWith({ appUserId: "owner", slug: "kara-live", locale: "ko" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["PUT", createPutLiveSurveyDraftHandler, "saveDraft"],
    ["POST", createPostLiveSurveySubmitHandler, "submit"],
  ] as const)("derives owner and accepts only canonical %s payload", async (method, factory, operation) => {
    const mutation = vi.fn().mockResolvedValue(operation === "saveDraft"
      ? { response: { status: "draft", revision: 1, answers, updatedAt: "2026-07-21T12:00:00.000Z" } }
      : { response: { status: "submitted", submittedAt: "2026-07-21T12:00:00.000Z", activityId: key, scorePoints: 2, stamp: { id: questionId, businessStatus: "issued", mintStatus: "queued" } } });
    const repository = { get: vi.fn(), saveDraft: vi.fn(), submit: vi.fn(), [operation]: mutation };
    const run = factory({ authorize: async () => ({ appUserId: "owner" }), repository });
    const payload = operation === "saveDraft" ? { idempotencyKey: key, expectedRevision: 0, answers } : { idempotencyKey: key, answers };
    const response = await run(request(method, payload), { slug: "kara-live" });
    expect(response.status).toBe(200);
    expect(mutation).toHaveBeenCalledWith(operation === "saveDraft"
      ? { appUserId: "owner", slug: "kara-live", idempotencyKey: key, expectedRevision: 0, answers }
      : { appUserId: "owner", slug: "kara-live", idempotencyKey: key, answers });

    const rejected = await run(request(method, { ...payload, appUserId: "attacker" }), { slug: "kara-live" });
    expect(rejected.status).toBe(400);
  });

  it("requires canonical authentication", async () => {
    const run = createGetLiveSurveyHandler({
      authorize: async () => { throw new AuthError("AUTHENTICATION_REQUIRED", 401, "invalid"); },
      repository: { get: vi.fn(), saveDraft: vi.fn(), submit: vi.fn() },
    });
    expect((await run(request("GET"), { slug: "kara-live" })).status).toBe(401);
  });

  it("QA-SURV-001 rejects survey read when attendance for the same LIVE is missing", async () => {
    const get = vi.fn().mockRejectedValue(new LiveSurveyRepositoryError("ATTENDANCE_REQUIRED"));
    const run = createGetLiveSurveyHandler({
      authorize: async () => ({ appUserId: "owner" }),
      repository: { get, saveDraft: vi.fn(), submit: vi.fn() },
    });

    const response = await run(request("GET"), { slug: "kara-live" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ATTENDANCE_REQUIRED" } });
    expect(get).toHaveBeenCalledWith({ appUserId: "owner", slug: "kara-live", locale: "ko" });
  });

  it.each([
    ["ATTENDANCE_REQUIRED", 403], ["INVALID_ANSWERS", 422], ["SURVEY_ALREADY_SUBMITTED", 409],
    ["IDEMPOTENCY_KEY_CONFLICT", 409], ["REVISION_CONFLICT", 409], ["SURVEY_INTEGRITY_ERROR", 503],
  ] as const)("maps %s to a stable response", async (code, status) => {
    const run = createPostLiveSurveySubmitHandler({
      authorize: async () => ({ appUserId: "owner" }),
      repository: { get: vi.fn(), saveDraft: vi.fn(), submit: async () => { throw new LiveSurveyRepositoryError(code); } },
    });
    expect((await run(request("POST", { idempotencyKey: key, answers }), { slug: "kara-live" })).status).toBe(status);
  });
});
