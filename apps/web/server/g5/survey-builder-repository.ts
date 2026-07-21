import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SurveyCommand =
  "create" | "edit" | "clone" | "order" | "publish" | "close" | "archive";
export type SurveyBuilderDocument = {
  liveEvent: { id: string; slug: string; status: string };
  selectedSurveyId?: string;
  versions: Array<{
    id: string;
    version: number;
    revision: number;
    status: "draft" | "published" | "closed" | "archived";
    publishedAt: string | null;
    closedAt: string | null;
    archivedAt: string | null;
    sourceSurveyId: string | null;
    questions: SurveyQuestion[];
  }>;
};
export type SurveyQuestion = {
  id?: string;
  type: "single_choice" | "multiple_choice" | "rating_1_5" | "free_text";
  commonKey:
    | "overall_satisfaction"
    | "purchase_intent"
    | "future_interest"
    | "free_comment"
    | null;
  required: boolean;
  position: number;
  text: { ko: string; en: string };
  options: Array<{
    id?: string;
    position: number;
    label: { ko: string; en: string };
  }>;
};
export class SurveyBuilderRepositoryError extends Error {
  constructor(
    readonly code:
      "NOT_FOUND" | "INVALID" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE",
  ) {
    super(code);
  }
}
export interface SurveyBuilderRepository {
  get(input: {
    actorAppUserId: string;
    actorAllowlistId: string;
    liveEventId: string;
  }): Promise<SurveyBuilderDocument>;
  write(input: {
    actorAppUserId: string;
    actorAllowlistId: string;
    liveEventId: string;
    command: SurveyCommand;
    payload: Record<string, unknown>;
    correlationId: string;
  }): Promise<SurveyBuilderDocument>;
}
type RpcClient = Pick<SupabaseClient, "rpc">;
function error(message: string) {
  if (message.includes("not found"))
    return new SurveyBuilderRepositoryError("NOT_FOUND");
  if (message.includes("viewer") || message.includes("administrator"))
    return new SurveyBuilderRepositoryError("FORBIDDEN");
  if (
    message.includes("only ") ||
    message.includes("stale survey revision") ||
    message.includes("immutable") ||
    message.includes("requires exact")
  )
    return new SurveyBuilderRepositoryError("CONFLICT");
  if (message.includes("invalid") || message.includes("required"))
    return new SurveyBuilderRepositoryError("INVALID");
  return new SurveyBuilderRepositoryError("UNAVAILABLE");
}
export function createSupabaseSurveyBuilderRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): SurveyBuilderRepository {
  const db =
    client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  return {
    async get(input) {
      const { data, error: rpcError } = await db.rpc("get_admin_live_survey", {
        p_actor_app_user_id: input.actorAppUserId,
        p_actor_allowlist_id: input.actorAllowlistId,
        p_live_event_id: input.liveEventId,
      });
      if (rpcError) throw error(rpcError.message);
      return data as SurveyBuilderDocument;
    },
    async write(input) {
      const { data, error: rpcError } = await db.rpc(
        "admin_write_live_survey",
        {
          p_actor_app_user_id: input.actorAppUserId,
          p_actor_allowlist_id: input.actorAllowlistId,
          p_live_event_id: input.liveEventId,
          p_command: input.command,
          p_payload: input.payload,
          p_correlation_id: input.correlationId,
        },
      );
      if (rpcError) throw error(rpcError.message);
      return data as SurveyBuilderDocument;
    },
  };
}
