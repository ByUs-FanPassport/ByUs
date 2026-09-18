import "server-only";

import { z } from "zod";

export const SALLY_BUG_REPORT_CHAT_ID = -5187701508;

const reportSchema = z.object({
  id: z.string().uuid(),
  telegram_chat_id: z.coerce.number().int(),
  telegram_message_id: z.coerce.number().int().positive(),
  telegram_update_id: z.coerce.number().int().nonnegative(),
  update_kind: z.enum(["message", "edited_message"]),
  message_sent_at: z.string(),
  message_edited_at: z.string().nullable(),
  sender: z.record(z.string(), z.unknown()),
  report_text: z.string().nullable(),
  media: z.array(z.record(z.string(), z.unknown())),
  reply_to_message_id: z.coerce.number().int().positive().nullable(),
  status: z.enum(["pending", "completed"]),
  completion_commit: z.string().nullable(),
  completion_deployment_url: z.string().nullable(),
  completion_reaction: z.string().nullable(),
  completed_at: z.string().nullable(),
  last_completion_error: z.string().nullable(),
  received_at: z.string(),
  updated_at: z.string(),
});

export type TelegramBugReport = z.infer<typeof reportSchema>;
export type TelegramBugReportStatus = TelegramBugReport["status"] | "all";

export type TelegramBugReportInput = {
  telegramUpdateId: number;
  telegramMessageId: number;
  telegramChatId: number;
  updateKind: "message" | "edited_message";
  messageSentAt: string;
  messageEditedAt: string | null;
  sender: Record<string, unknown>;
  reportText: string | null;
  media: Array<Record<string, unknown>>;
  replyToMessageId: number | null;
};

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export type TelegramBugReportRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): RpcResult;
};

export interface TelegramBugReportRepository {
  ingest(input: TelegramBugReportInput): Promise<void>;
  list(status: TelegramBugReportStatus, limit: number): Promise<TelegramBugReport[]>;
  get(messageId: number): Promise<TelegramBugReport | null>;
  complete(input: { messageId: number; commit: string; deploymentUrl: string; reaction: "👌" }): Promise<void>;
  recordCompletionError(messageId: number, code: string): Promise<void>;
}

function assertRpcSuccess(error: { message?: string } | null): void {
  if (error) throw new Error("TELEGRAM_BUG_REPORT_REPOSITORY_UNAVAILABLE");
}

export function createTelegramBugReportRepository(client: TelegramBugReportRpcClient): TelegramBugReportRepository {
  return {
    async ingest(input) {
      const { data, error } = await client.rpc("ingest_telegram_bug_report", {
        p_telegram_update_id: input.telegramUpdateId,
        p_telegram_message_id: input.telegramMessageId,
        p_telegram_chat_id: input.telegramChatId,
        p_update_kind: input.updateKind,
        p_message_sent_at: input.messageSentAt,
        p_message_edited_at: input.messageEditedAt,
        p_sender: input.sender,
        p_report_text: input.reportText,
        p_media: input.media,
        p_reply_to_message_id: input.replyToMessageId,
      });
      assertRpcSuccess(error);
      if (!z.string().uuid().safeParse(data).success) throw new Error("TELEGRAM_BUG_REPORT_REPOSITORY_UNAVAILABLE");
    },

    async list(status, limit) {
      const { data, error } = await client.rpc("list_telegram_bug_reports", {
        p_status: status,
        p_limit: limit,
      });
      assertRpcSuccess(error);
      return z.array(reportSchema).parse(data);
    },

    async get(messageId) {
      const { data, error } = await client.rpc("get_telegram_bug_report", {
        p_telegram_chat_id: SALLY_BUG_REPORT_CHAT_ID,
        p_telegram_message_id: messageId,
      });
      assertRpcSuccess(error);
      if (data === null) return null;
      return reportSchema.parse(data);
    },

    async complete(input) {
      const { data, error } = await client.rpc("complete_telegram_bug_report", {
        p_telegram_chat_id: SALLY_BUG_REPORT_CHAT_ID,
        p_telegram_message_id: input.messageId,
        p_commit: input.commit,
        p_deployment_url: input.deploymentUrl,
        p_reaction: input.reaction,
      });
      assertRpcSuccess(error);
      if (data !== true) throw new Error("TELEGRAM_BUG_REPORT_NOT_FOUND");
    },

    async recordCompletionError(messageId, code) {
      const { error } = await client.rpc("record_telegram_bug_report_completion_error", {
        p_telegram_chat_id: SALLY_BUG_REPORT_CHAT_ID,
        p_telegram_message_id: messageId,
        p_error: code,
      });
      assertRpcSuccess(error);
    },
  };
}
