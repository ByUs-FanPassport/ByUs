import "server-only";

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  SALLY_BUG_REPORT_CHAT_ID,
  type TelegramBugReportInput,
  type TelegramBugReportRepository,
  type TelegramBugReportStatus,
} from "./bug-report-repository";
import type { TelegramReactionPort } from "./bot-api";

const MAX_BODY_BYTES = 512 * 1024;
const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Authorization" };
const WEBHOOK_HEADERS = { "cache-control": "no-store" };

const senderSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
}).passthrough();

const fileSchema = z.object({
  file_id: z.string().min(1),
  file_unique_id: z.string().min(1),
  file_size: z.number().int().nonnegative().optional(),
}).passthrough();

const photoSchema = fileSchema.extend({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

const documentSchema = fileSchema.extend({
  file_name: z.string().max(512).optional(),
  mime_type: z.string().max(256).optional(),
});

const timedFileSchema = fileSchema.extend({
  duration: z.number().int().nonnegative().optional(),
  mime_type: z.string().max(256).optional(),
  file_name: z.string().max(512).optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
});

const messageSchema = z.object({
  message_id: z.number().int().positive(),
  date: z.number().int().nonnegative(),
  edit_date: z.number().int().nonnegative().optional(),
  chat: z.object({ id: z.number().int() }).passthrough(),
  from: senderSchema.optional(),
  text: z.string().max(20_000).optional(),
  caption: z.string().max(20_000).optional(),
  photo: z.array(photoSchema).min(1).optional(),
  document: documentSchema.optional(),
  video: timedFileSchema.optional(),
  animation: timedFileSchema.optional(),
  audio: timedFileSchema.optional(),
  voice: timedFileSchema.optional(),
  reply_to_message: z.object({ message_id: z.number().int().positive() }).passthrough().optional(),
}).passthrough();

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
}).passthrough();

const completionSchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  deploymentUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (
      url.hostname === "byus.kr" ||
      url.hostname === "www.byus.kr" ||
      url.hostname.endsWith(".vercel.app")
    );
  }),
});

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function boundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function compactFile(kind: string, file: z.infer<typeof timedFileSchema>): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    kind,
    fileId: file.file_id,
    fileUniqueId: file.file_unique_id,
    fileName: file.file_name,
    mimeType: file.mime_type,
    fileSize: file.file_size,
    width: file.width,
    height: file.height,
    duration: file.duration,
  }).filter(([, value]) => value !== undefined));
}

function extractMedia(message: z.infer<typeof messageSchema>): Array<Record<string, unknown>> {
  const media: Array<Record<string, unknown>> = [];
  const photo = message.photo?.at(-1);
  if (photo) media.push(compactFile("photo", photo));
  if (message.document) media.push(compactFile("document", message.document));
  if (message.video) media.push(compactFile("video", message.video));
  if (message.animation) media.push(compactFile("animation", message.animation));
  if (message.audio) media.push(compactFile("audio", message.audio));
  if (message.voice) media.push(compactFile("voice", message.voice));
  return media;
}

function toInput(update: z.infer<typeof updateSchema>): TelegramBugReportInput | null {
  const updateKind = update.edited_message ? "edited_message" : "message";
  const message = update.edited_message ?? update.message;
  if (!message) return null;
  const media = extractMedia(message);
  const reportText = message.text ?? message.caption ?? null;
  if (!reportText?.trim() && media.length === 0) return null;
  const sender = message.from ? Object.fromEntries(Object.entries({
    id: message.from.id,
    isBot: message.from.is_bot,
    firstName: message.from.first_name,
    lastName: message.from.last_name,
    username: message.from.username,
  }).filter(([, value]) => value !== undefined)) : {};
  return {
    telegramUpdateId: update.update_id,
    telegramMessageId: message.message_id,
    telegramChatId: message.chat.id,
    updateKind,
    messageSentAt: new Date(message.date * 1000).toISOString(),
    messageEditedAt: message.edit_date ? new Date(message.edit_date * 1000).toISOString() : null,
    sender,
    reportText,
    media,
    replyToMessageId: message.reply_to_message?.message_id ?? null,
  };
}

function operatorAuthorized(request: Request, secret?: string): boolean {
  if (!secret) return false;
  return constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export function createTelegramBugReportWebhookHandler(dependencies: {
  secret?: string;
  repository: Pick<TelegramBugReportRepository, "ingest">;
}) {
  return async (request: Request): Promise<Response> => {
    if (!dependencies.secret) return Response.json({ error: { code: "TELEGRAM_WEBHOOK_UNAVAILABLE" } }, { status: 503, headers: WEBHOOK_HEADERS });
    const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!constantTimeEqual(receivedSecret, dependencies.secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers: WEBHOOK_HEADERS });
    }
    let input: TelegramBugReportInput | null;
    try {
      input = toInput(updateSchema.parse(await boundedJson(request)));
    } catch (error) {
      const status = error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400;
      return Response.json({ error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" } }, { status, headers: WEBHOOK_HEADERS });
    }
    if (!input) return Response.json({ ok: true, ignored: "non_report_update" }, { headers: WEBHOOK_HEADERS });
    if (input.telegramChatId !== SALLY_BUG_REPORT_CHAT_ID) {
      return Response.json({ ok: true, ignored: "chat_not_allowed" }, { headers: WEBHOOK_HEADERS });
    }
    try {
      await dependencies.repository.ingest(input);
      return Response.json({ ok: true, messageId: input.telegramMessageId }, { headers: WEBHOOK_HEADERS });
    } catch {
      return Response.json({ error: { code: "TELEGRAM_WEBHOOK_UNAVAILABLE" } }, { status: 503, headers: WEBHOOK_HEADERS });
    }
  };
}

export function createTelegramBugReportListHandler(dependencies: {
  secret?: string;
  repository: Pick<TelegramBugReportRepository, "list">;
}) {
  return async (request: Request): Promise<Response> => {
    if (!dependencies.secret) return Response.json({ error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } }, { status: 503, headers: PRIVATE_HEADERS });
    if (!operatorAuthorized(request, dependencies.secret)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers: PRIVATE_HEADERS });
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") ?? "pending") as TelegramBugReportStatus;
    const limit = Number(url.searchParams.get("limit") ?? "20");
    if (!(["pending", "completed", "all"] as const).includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400, headers: PRIVATE_HEADERS });
    }
    try {
      return Response.json({ reports: await dependencies.repository.list(status, limit) }, { headers: PRIVATE_HEADERS });
    } catch {
      return Response.json({ error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } }, { status: 503, headers: PRIVATE_HEADERS });
    }
  };
}

export function createTelegramBugReportCompletionHandler(dependencies: {
  secret?: string;
  repository: Pick<TelegramBugReportRepository, "get" | "complete" | "recordCompletionError">;
  telegram: TelegramReactionPort;
}) {
  return async (request: Request, messageId: number): Promise<Response> => {
    if (!dependencies.secret) return Response.json({ error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } }, { status: 503, headers: PRIVATE_HEADERS });
    if (!operatorAuthorized(request, dependencies.secret)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers: PRIVATE_HEADERS });
    if (!Number.isSafeInteger(messageId) || messageId < 1) return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400, headers: PRIVATE_HEADERS });
    let completion: z.infer<typeof completionSchema>;
    try {
      completion = completionSchema.parse(await boundedJson(request));
    } catch (error) {
      const status = error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400;
      return Response.json({ error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" } }, { status, headers: PRIVATE_HEADERS });
    }
    let report;
    try {
      report = await dependencies.repository.get(messageId);
    } catch {
      return Response.json({ error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } }, { status: 503, headers: PRIVATE_HEADERS });
    }
    if (!report) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: PRIVATE_HEADERS });
    if (report.status === "completed") {
      return Response.json({ ok: true, status: "already_completed", messageId }, { headers: PRIVATE_HEADERS });
    }
    try {
      await dependencies.telegram.setOkayReaction({ chatId: SALLY_BUG_REPORT_CHAT_ID, messageId });
    } catch {
      await dependencies.repository.recordCompletionError(messageId, "TELEGRAM_REACTION_FAILED").catch(() => undefined);
      return Response.json({ error: { code: "TELEGRAM_REACTION_FAILED" } }, { status: 502, headers: PRIVATE_HEADERS });
    }
    try {
      await dependencies.repository.complete({ messageId, ...completion, reaction: "👌" });
      return Response.json({ ok: true, status: "completed", messageId, reaction: "👌" }, { headers: PRIVATE_HEADERS });
    } catch {
      await dependencies.repository.recordCompletionError(messageId, "COMPLETION_PERSISTENCE_FAILED").catch(() => undefined);
      return Response.json({ error: { code: "COMPLETION_PERSISTENCE_FAILED" } }, { status: 503, headers: PRIVATE_HEADERS });
    }
  };
}
