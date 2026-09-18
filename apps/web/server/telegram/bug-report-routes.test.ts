import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createTelegramBugReportCompletionHandler,
  createTelegramBugReportListHandler,
  createTelegramBugReportWebhookHandler,
} from "./bug-report-routes";
import type { TelegramBugReport } from "./bug-report-repository";

const webhookSecret = "webhook_secret_abcdefghijklmnopqrstuvwxyz";
const operatorSecret = "operator_secret_abcdefghijklmnopqrstuvwxyz";

function telegramRequest(body: unknown, secret = webhookSecret): Request {
  return new Request("https://byus.kr/api/telegram/bug-reports/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}

function completionRequest(body: unknown, secret = operatorSecret): Request {
  return new Request("https://byus.kr/api/internal/telegram/bug-reports/55/complete", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

const update = {
  update_id: 8001,
  message: {
    message_id: 55,
    date: 1_789_710_000,
    chat: { id: -5187701508, title: "Sally_Bug_Report", type: "group" },
    from: { id: 123, first_name: "Sally", username: "reporter" },
    caption: "Image bug",
    photo: [
      { file_id: "small", file_unique_id: "small-unique", width: 100, height: 100 },
      { file_id: "large", file_unique_id: "large-unique", width: 1200, height: 900, file_size: 4000 },
    ],
  },
};

const report: TelegramBugReport = {
  id: "11111111-1111-4111-8111-111111111111",
  telegram_chat_id: -5187701508,
  telegram_message_id: 55,
  telegram_update_id: 8001,
  update_kind: "message",
  message_sent_at: "2026-09-18T07:00:00.000Z",
  message_edited_at: null,
  sender: { id: 123 },
  report_text: "Image bug",
  media: [{ kind: "photo", fileId: "large" }],
  reply_to_message_id: null,
  status: "pending",
  completion_commit: null,
  completion_deployment_url: null,
  completion_reaction: null,
  completed_at: null,
  last_completion_error: null,
  received_at: "2026-09-18T07:00:01.000Z",
  updated_at: "2026-09-18T07:00:01.000Z",
};

describe("Telegram bug report webhook", () => {
  it("fails closed without the configured Telegram secret and rejects a wrong secret", async () => {
    const ingest = vi.fn();
    expect((await createTelegramBugReportWebhookHandler({ repository: { ingest } })(telegramRequest(update))).status).toBe(503);
    expect((await createTelegramBugReportWebhookHandler({ secret: webhookSecret, repository: { ingest } })(telegramRequest(update, "wrong"))).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("allowlists Sally_Bug_Report and persists the largest photo metadata", async () => {
    const ingest = vi.fn(async () => undefined);
    const response = await createTelegramBugReportWebhookHandler({ secret: webhookSecret, repository: { ingest } })(telegramRequest(update));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, messageId: 55 });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      telegramChatId: -5187701508,
      telegramMessageId: 55,
      telegramUpdateId: 8001,
      reportText: "Image bug",
      media: [{ kind: "photo", fileId: "large", fileUniqueId: "large-unique", fileSize: 4000, width: 1200, height: 900 }],
    }));
  });

  it("acknowledges another chat without persisting it", async () => {
    const ingest = vi.fn();
    const foreignUpdate = { ...update, message: { ...update.message, chat: { id: -999, type: "group" } } };
    const response = await createTelegramBugReportWebhookHandler({ secret: webhookSecret, repository: { ingest } })(telegramRequest(foreignUpdate));
    expect(await response.json()).toEqual({ ok: true, ignored: "chat_not_allowed" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when persistence fails", async () => {
    const ingest = vi.fn(async () => { throw new Error("private database error"); });
    const response = await createTelegramBugReportWebhookHandler({ secret: webhookSecret, repository: { ingest } })(telegramRequest(update));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TELEGRAM_WEBHOOK_UNAVAILABLE" } });
  });
});

describe("Telegram bug report operator routes", () => {
  it("authenticates pending-list access with the operator secret", async () => {
    const list = vi.fn(async () => [report]);
    const handler = createTelegramBugReportListHandler({ secret: operatorSecret, repository: { list } });
    expect((await handler(new Request("https://byus.kr/api/internal/telegram/bug-reports"))).status).toBe(401);
    const response = await handler(new Request("https://byus.kr/api/internal/telegram/bug-reports?status=pending&limit=5", { headers: { authorization: `Bearer ${operatorSecret}` } }));
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith("pending", 5);
  });

  it("reacts with okay before recording deterministic completion metadata", async () => {
    const get = vi.fn(async () => report);
    const complete = vi.fn(async () => undefined);
    const recordCompletionError = vi.fn(async () => undefined);
    const setOkayReaction = vi.fn(async () => undefined);
    const response = await createTelegramBugReportCompletionHandler({
      secret: operatorSecret,
      repository: { get, complete, recordCompletionError },
      telegram: { setOkayReaction },
    })(completionRequest({ commit: "abcdef1", deploymentUrl: "https://byus.kr" }), 55);
    expect(response.status).toBe(200);
    expect(setOkayReaction).toHaveBeenCalledWith({ chatId: -5187701508, messageId: 55 });
    expect(complete).toHaveBeenCalledWith({ messageId: 55, commit: "abcdef1", deploymentUrl: "https://byus.kr", reaction: "👌" });
    expect(recordCompletionError).not.toHaveBeenCalled();
  });

  it("is idempotent after completion and does not send a second reaction", async () => {
    const completed = { ...report, status: "completed" as const, completion_reaction: "👌" };
    const complete = vi.fn();
    const setOkayReaction = vi.fn();
    const response = await createTelegramBugReportCompletionHandler({
      secret: operatorSecret,
      repository: { get: vi.fn(async () => completed), complete, recordCompletionError: vi.fn() },
      telegram: { setOkayReaction },
    })(completionRequest({ commit: "abcdef1", deploymentUrl: "https://byus.kr" }), 55);
    expect(await response.json()).toEqual({ ok: true, status: "already_completed", messageId: 55 });
    expect(setOkayReaction).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("records a stable failure code when Telegram rejects the reaction", async () => {
    const recordCompletionError = vi.fn(async () => undefined);
    const response = await createTelegramBugReportCompletionHandler({
      secret: operatorSecret,
      repository: { get: vi.fn(async () => report), complete: vi.fn(), recordCompletionError },
      telegram: { setOkayReaction: vi.fn(async () => { throw new Error("provider details"); }) },
    })(completionRequest({ commit: "abcdef1", deploymentUrl: "https://byus.kr" }), 55);
    expect(response.status).toBe(502);
    expect(recordCompletionError).toHaveBeenCalledWith(55, "TELEGRAM_REACTION_FAILED");
  });
});
