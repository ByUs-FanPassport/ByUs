import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { deriveCredentialId } from "../../features/passport/domain/credential-issuance";
import {
  projectLiveSurvey,
  projectSavedSurveyDraft,
  projectSubmittedSurvey,
  type LiveSurveyLocale,
  type LiveSurveyResponse,
  type SaveLiveSurveyDraftResponse,
  type SubmitLiveSurveyResponse,
  type SurveyAnswer,
} from "../../features/live/domain/live-survey";

export type LiveSurveyFailureCode =
  | "SURVEY_NOT_FOUND"
  | "ATTENDANCE_REQUIRED"
  | "SURVEY_ALREADY_SUBMITTED"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "INVALID_ANSWERS"
  | "PASSPORT_REQUIRED"
  | "WALLET_NOT_READY"
  | "USER_UNAVAILABLE"
  | "SURVEY_INTEGRITY_ERROR";

export class LiveSurveyRepositoryError extends Error {
  constructor(readonly code: LiveSurveyFailureCode) {
    super(code);
    this.name = "LiveSurveyRepositoryError";
  }
}

export interface LiveSurveyRepository {
  get(input: { appUserId: string; slug: string; locale: LiveSurveyLocale }): Promise<LiveSurveyResponse | null>;
  saveDraft(input: { appUserId: string; slug: string; idempotencyKey: string; expectedRevision: number; answers: SurveyAnswer[] }): Promise<SaveLiveSurveyDraftResponse>;
  submit(input: { appUserId: string; slug: string; idempotencyKey: string; answers: SurveyAnswer[] }): Promise<SubmitLiveSurveyResponse>;
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}

const failureMap: Readonly<Record<string, LiveSurveyFailureCode>> = {
  G3_SURVEY_NOT_FOUND: "SURVEY_NOT_FOUND",
  G3_ATTENDANCE_REQUIRED: "ATTENDANCE_REQUIRED",
  G3_SURVEY_ALREADY_SUBMITTED: "SURVEY_ALREADY_SUBMITTED",
  G3_SURVEY_REVISION_CONFLICT: "REVISION_CONFLICT",
  G3_SURVEY_IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  G3_SURVEY_INVALID_ANSWERS: "INVALID_ANSWERS",
  G3_SURVEY_PASSPORT_REQUIRED: "PASSPORT_REQUIRED",
  G3_SURVEY_WALLET_NOT_READY: "WALLET_NOT_READY",
  G3_SURVEY_USER_UNAVAILABLE: "USER_UNAVAILABLE",
  G3_SURVEY_INTEGRITY_ERROR: "SURVEY_INTEGRITY_ERROR",
  G3_SURVEY_ISSUANCE_CONFLICT: "SURVEY_INTEGRITY_ERROR",
};

function mapFailure(error: { message?: string }): LiveSurveyRepositoryError {
  const marker = Object.keys(failureMap).find((candidate) => error.message?.includes(candidate));
  return new LiveSurveyRepositoryError(marker ? failureMap[marker] : "SURVEY_INTEGRITY_ERROR");
}

export class SupabaseLiveSurveyRepository implements LiveSurveyRepository {
  constructor(private readonly database: RpcClient, private readonly createId: () => string = randomUUID) {}

  async get(input: { appUserId: string; slug: string; locale: LiveSurveyLocale }): Promise<LiveSurveyResponse | null> {
    const { data, error } = await this.database.rpc("get_owned_live_survey", {
      p_app_user_id: input.appUserId,
      p_live_slug: input.slug,
      p_locale: input.locale,
    });
    if (error) throw mapFailure(error);
    if (data === null) return null;
    try { return projectLiveSurvey(data); }
    catch { throw new LiveSurveyRepositoryError("SURVEY_INTEGRITY_ERROR"); }
  }

  async saveDraft(input: { appUserId: string; slug: string; idempotencyKey: string; expectedRevision: number; answers: SurveyAnswer[] }): Promise<SaveLiveSurveyDraftResponse> {
    const { data, error } = await this.database.rpc("save_owned_live_survey_draft", {
      p_app_user_id: input.appUserId,
      p_live_slug: input.slug,
      p_idempotency_key: input.idempotencyKey,
      p_expected_revision: input.expectedRevision,
      p_answers: input.answers,
    });
    if (error) throw mapFailure(error);
    try { return projectSavedSurveyDraft(data); }
    catch { throw new LiveSurveyRepositoryError("SURVEY_INTEGRITY_ERROR"); }
  }

  async submit(input: { appUserId: string; slug: string; idempotencyKey: string; answers: SurveyAnswer[] }): Promise<SubmitLiveSurveyResponse> {
    const stampId = this.createId();
    const operationKey = `byus:stamp:v1:${stampId}`;
    const { data, error } = await this.database.rpc("submit_owned_live_survey", {
      p_app_user_id: input.appUserId,
      p_live_slug: input.slug,
      p_idempotency_key: input.idempotencyKey,
      p_answers: input.answers,
      p_stamp_id: stampId,
      p_stamp_operation_key: operationKey,
      p_stamp_issuance_id: deriveCredentialId(operationKey),
    });
    if (error) throw mapFailure(error);
    try { return projectSubmittedSurvey(data); }
    catch { throw new LiveSurveyRepositoryError("SURVEY_INTEGRITY_ERROR"); }
  }
}

export function createLiveSurveyRepositoryFromEnvironment(config: { url: string; serviceRoleKey: string }): LiveSurveyRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseLiveSurveyRepository(client as unknown as RpcClient);
}
