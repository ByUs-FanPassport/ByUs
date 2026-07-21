import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseLiveSurveyRepository } from "./live-survey-repository";

const appUserId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const stampId = "33333333-3333-4333-8333-333333333333";
const questionId = "44444444-4444-4444-8444-444444444444";
const answers = [{ questionId, rating: 5 }];

describe("SupabaseLiveSurveyRepository", () => {
  it("calls the owner-scoped draft RPC without caller-controlled identity", async () => {
    const data = { response: { status: "draft", revision: 1, answers, updatedAt: "2026-07-21T12:00:00.000Z" } };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const repository = new SupabaseLiveSurveyRepository({ rpc }, () => stampId);
    expect(await repository.saveDraft({ appUserId, slug: "kara-live", idempotencyKey, expectedRevision: 0, answers })).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("save_owned_live_survey_draft", { p_app_user_id: appUserId, p_live_slug: "kara-live", p_idempotency_key: idempotencyKey, p_expected_revision: 0, p_answers: answers });
  });

  it("derives all Survey issuance identifiers on the server", async () => {
    const data = { response: { status: "submitted", submittedAt: "2026-07-21T12:00:00.000Z", activityId: "55555555-5555-4555-8555-555555555555", scorePoints: 2, stamp: { id: stampId, businessStatus: "issued", mintStatus: "queued" } } };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const repository = new SupabaseLiveSurveyRepository({ rpc }, () => stampId);
    expect(await repository.submit({ appUserId, slug: "kara-live", idempotencyKey, answers })).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("submit_owned_live_survey", expect.objectContaining({ p_stamp_id: stampId, p_stamp_operation_key: `byus:stamp:v1:${stampId}`, p_stamp_issuance_id: expect.stringMatching(/^0x[0-9a-f]{64}$/) }));
  });
});
