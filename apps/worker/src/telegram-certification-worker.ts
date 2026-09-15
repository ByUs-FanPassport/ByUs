import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NotificationWorkerEnv } from "./notification-env.js";
import { validatedTelegramConfig } from "./telegram-alert-worker.js";

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 8_000;
const CAPTION_LIMIT = 1_024;
const CALLBACK_TOKEN = /^[0-9a-f]{32}$/u;
const ADMIN_CERTIFICATIONS_URL = "https://byus.kr/admin/certifications";

const uuid = z.uuid();
const nonnegative = z.number().int().nonnegative();
const positive = z.number().int().positive();
const uploadSchema = z.object({
  upload_id: uuid,
  upload_order: nonnegative,
  object_path: z.string().min(1).max(1_024),
  content_type: z.string().min(1).max(128),
  width: positive,
  height: positive,
}).strict();
const rewardSchema = z.object({
  score_points: nonnegative,
  ticket_amount: nonnegative,
  stamp_count: nonnegative,
}).strict();
const claimSchema = z.object({
  delivery_id: uuid,
  submission_id: uuid,
  callback_token: z.string().regex(CALLBACK_TOKEN),
  expected_review_revision: nonnegative,
  creator_name: z.string().min(1).max(512),
  mission_title: z.string().min(1).max(1_024),
  membership_platform: z.string().min(1).max(256).nullable(),
  applicant_nickname: z.string().min(1).max(512),
  attempt_number: positive,
  submitted_at: z.iso.datetime({ offset: true }),
  note: z.string().max(8_000).nullable(),
  reward: rewardSchema,
  uploads: z.array(uploadSchema).min(1).max(3),
}).strict().superRefine((claim, context) => {
  const ids = new Set<string>();
  claim.uploads.forEach((upload, index) => {
    if (upload.upload_order !== index + 1) context.addIssue({ code: "custom", path: ["uploads", index, "upload_order"], message: "upload order must be contiguous" });
    if (ids.has(upload.upload_id)) context.addIssue({ code: "custom", path: ["uploads", index, "upload_id"], message: "duplicate upload" });
    ids.add(upload.upload_id);
  });
});

export interface TelegramCertificationUpload {
  id: string;
  order: number;
  objectPath: string;
  contentType: string;
  width: number;
  height: number;
}

export interface TelegramCertificationReward {
  scorePoints: number;
  ticketAmount: number;
  stampCount: number;
}

export interface TelegramCertificationClaim {
  deliveryId: string;
  submissionId: string;
  callbackToken: string;
  expectedReviewRevision: number;
  creatorName: string;
  missionTitle: string;
  membershipPlatform: string | null;
  applicantNickname: string;
  attemptNumber: number;
  submittedAt: string;
  note: string | null;
  reward: TelegramCertificationReward;
  uploads: TelegramCertificationUpload[];
}

export type TelegramCertificationDeliveryOutcome = "sent" | "throttled" | "rejected" | "delivery_unknown";

export interface TelegramCertificationCallback {
  updateId: number;
  queryId: string;
  callbackToken: string;
  telegramUserId: number;
  displayName: string;
  username: string | null;
  messageId: number;
  caption: string;
}

export type TelegramApproval = { outcome: "approved" | "already_processed"; submissionId: string };
export interface TelegramCertificationHealth {
  pending: number; claimed: number; sending: number; sent: number; partial: number;
  failed: number; deliveryUnknown: number; skipped: number;
}

export interface TelegramCertificationQueue {
  claim(chatId: string): Promise<TelegramCertificationClaim | null>;
  begin(deliveryId: string, chatId: string): Promise<void>;
  record(deliveryId: string, chatId: string, uploadId: string, uploadOrder: number, outcome: TelegramCertificationDeliveryOutcome, providerMessageId: number | null, retryAfter: number | null): Promise<void>;
  health(): Promise<TelegramCertificationHealth>;
  approve?(chatId: string, callback: TelegramCertificationCallback): Promise<TelegramApproval>;
}

type RpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

const approvalSchema = z.object({
  outcome: z.enum(["approved", "already_processed"]),
  submission_id: uuid,
}).passthrough();
const healthSchema = z.object({
  enabled: z.boolean(), chat_id: z.string().nullable(), activated_at: z.string().nullable(),
  next_send_at: z.string(), lease_expires_at: z.string().nullable(),
  pending: nonnegative, claimed: nonnegative, sending: nonnegative, sent: nonnegative,
  partial: nonnegative, failed: nonnegative, delivery_unknown: nonnegative, skipped: nonnegative,
}).strict();

export class SupabaseTelegramCertificationQueue implements TelegramCertificationQueue {
  constructor(private readonly db: RpcClient) {}

  private async call(name: string, args?: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await this.db.rpc(name, args);
      if (error) throw new Error();
      return data;
    } catch {
      throw new Error("TELEGRAM_CERTIFICATION_QUEUE_UNAVAILABLE");
    }
  }

  async claim(chatId: string): Promise<TelegramCertificationClaim | null> {
    const raw = await this.call("claim_telegram_certification_delivery", { p_chat_id: chatId });
    if (raw === null) return null;
    const parsed = claimSchema.safeParse(raw);
    if (!parsed.success) throw new Error("TELEGRAM_CERTIFICATION_INVALID_CLAIM");
    const claim = parsed.data;
    return {
      deliveryId: claim.delivery_id,
      submissionId: claim.submission_id,
      callbackToken: claim.callback_token,
      expectedReviewRevision: claim.expected_review_revision,
      creatorName: claim.creator_name,
      missionTitle: claim.mission_title,
      membershipPlatform: claim.membership_platform,
      applicantNickname: claim.applicant_nickname,
      attemptNumber: claim.attempt_number,
      submittedAt: claim.submitted_at,
      note: claim.note,
      reward: { scorePoints: claim.reward.score_points, ticketAmount: claim.reward.ticket_amount, stampCount: claim.reward.stamp_count },
      uploads: claim.uploads.map((upload) => ({
        id: upload.upload_id, order: upload.upload_order, objectPath: upload.object_path,
        contentType: upload.content_type, width: upload.width, height: upload.height,
      })),
    };
  }

  async record(deliveryId: string, chatId: string, uploadId: string, uploadOrder: number, outcome: TelegramCertificationDeliveryOutcome, providerMessageId: number | null, retryAfter: number | null): Promise<void> {
    const result = await this.call("record_telegram_certification_delivery", {
      p_delivery_id: deliveryId,
      p_chat_id: chatId,
      p_outcome: outcome,
      p_upload_id: uploadId,
      p_upload_order: uploadOrder,
      p_provider_message_id: providerMessageId,
      p_retry_after: retryAfter,
      p_error_code: null,
    });
    if (object(result)?.accepted !== true) throw new Error("TELEGRAM_CERTIFICATION_QUEUE_UNAVAILABLE");
  }

  async begin(deliveryId: string, chatId: string): Promise<void> {
    const result = await this.call("record_telegram_certification_delivery", {
      p_delivery_id: deliveryId,
      p_chat_id: chatId,
      p_outcome: "sending",
      p_upload_id: null,
      p_upload_order: null,
      p_provider_message_id: null,
      p_retry_after: null,
      p_error_code: null,
    });
    if (object(result)?.accepted !== true) throw new Error("TELEGRAM_CERTIFICATION_QUEUE_UNAVAILABLE");
  }

  async approve(chatId: string, callback: TelegramCertificationCallback): Promise<TelegramApproval> {
    const raw = await this.call("approve_telegram_certification", {
      p_chat_id: chatId,
      p_callback_token: callback.callbackToken,
      p_action_message_id: callback.messageId,
      p_telegram_user_id: callback.telegramUserId,
      p_telegram_display_name: callback.displayName,
      p_telegram_username: callback.username,
    });
    const parsed = approvalSchema.safeParse(raw);
    if (!parsed.success) throw new Error("TELEGRAM_CERTIFICATION_APPROVAL_FAILED");
    return { outcome: parsed.data.outcome, submissionId: parsed.data.submission_id };
  }

  async health(): Promise<TelegramCertificationHealth> {
    const parsed = healthSchema.safeParse(await this.call("telegram_certification_review_health"));
    if (!parsed.success) throw new Error("TELEGRAM_CERTIFICATION_QUEUE_UNAVAILABLE");
    return {
      pending: parsed.data.pending, claimed: parsed.data.claimed, sending: parsed.data.sending,
      sent: parsed.data.sent, partial: parsed.data.partial, failed: parsed.data.failed,
      deliveryUnknown: parsed.data.delivery_unknown, skipped: parsed.data.skipped,
    };
  }
}

export interface TelegramCertificationStorage { download(objectPath: string): Promise<Blob> }

type StorageClient = { storage: { from(bucket: string): { download(path: string): PromiseLike<{ data: Blob | null; error: unknown }> } } };

export class SupabaseCertificationStorage implements TelegramCertificationStorage {
  constructor(private readonly db: StorageClient) {}
  async download(objectPath: string): Promise<Blob> {
    try {
      const { data, error } = await this.db.storage.from("certification-proofs").download(objectPath);
      if (error || !data) throw new Error();
      return data;
    } catch {
      throw new Error("TELEGRAM_CERTIFICATION_STORAGE_UNAVAILABLE");
    }
  }
}

function sanitize(value: string, maxLength: number): string {
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (clean.length <= maxLength) return clean;
  let prefix = clean.slice(0, Math.max(0, maxLength - 1));
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix.trimEnd()}…`;
}

function seoulTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function rewardText(reward: TelegramCertificationReward): string {
  const parts: string[] = [];
  if (reward.scorePoints > 0) parts.push(`활동 점수 ${reward.scorePoints}점`);
  if (reward.ticketAmount > 0) parts.push(`응모권 ${reward.ticketAmount}장`);
  if (reward.stampCount > 0) parts.push(`멤버십 스탬프 ${reward.stampCount}개`);
  return parts.length ? parts.join(" · ") : "추가 보상 없음";
}

export function renderTelegramCertificationCaption(claim: TelegramCertificationClaim): string {
  const lines = [
    "📸 새 인증 검토",
    `${sanitize(claim.creatorName, 80)} · ${sanitize(claim.missionTitle, 120)}`,
    ...(claim.membershipPlatform ? [`플랫폼: ${sanitize(claim.membershipPlatform, 64)}`] : []),
    `신청자: ${sanitize(claim.applicantNickname, 80)}`,
    `${claim.attemptNumber}번째 제출 · ${seoulTimestamp(claim.submittedAt)}`,
    `보상: ${rewardText(claim.reward)}`,
    `메모: ${claim.note ? sanitize(claim.note, 1_500) : "없음"}`,
  ];
  return sanitize(lines.join("\n"), CAPTION_LIMIT);
}

export class TelegramDeliveryError extends Error {
  constructor(readonly outcome: Exclude<TelegramCertificationDeliveryOutcome, "sent">, readonly retryAfter?: number) {
    super(`TELEGRAM_CERTIFICATION_${outcome.toUpperCase()}`);
  }
}

export interface SendProofInput {
  upload: TelegramCertificationUpload;
  bytes: Blob;
  caption: string | null;
  callbackToken: string | null;
  adminUrl: string | null;
  replyToMessageId: number | null;
}

export interface TelegramCertificationSender {
  sendProof(input: SendProofInput): Promise<number>;
}

export interface TelegramCertificationCallbackApi {
  answerCallback(queryId: string, text: string, showAlert: boolean): Promise<void>;
  editApproved(messageId: number, existingCaption: string, displayName: string, adminUrl: string): Promise<void>;
}

type Fetch = typeof fetch;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function retryAfter(body: unknown): number {
  const raw = object(object(body)?.parameters)?.retry_after;
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 60;
  return Math.max(1, Math.min(86_400, seconds));
}

function proofMethod(upload: TelegramCertificationUpload): "sendPhoto" | "sendDocument" {
  const ratio = Math.max(upload.width / upload.height, upload.height / upload.width);
  return upload.contentType.startsWith("image/") && upload.width + upload.height <= 10_000 && ratio <= 20
    ? "sendPhoto" : "sendDocument";
}

export class TelegramCertificationHttpClient implements TelegramCertificationSender, TelegramCertificationCallbackApi {
  constructor(private readonly config: { token: string; chatId: string }, private readonly fetcher: Fetch = fetch) {}

  private async request(method: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${TELEGRAM_API_ORIGIN}/bot${this.config.token}/${method}`, {
        ...init, redirect: "error", signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
    } catch {
      throw new TelegramDeliveryError("delivery_unknown");
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new TelegramDeliveryError("delivery_unknown"); }
    const errorCode = object(body)?.error_code;
    if (response.status === 429 || errorCode === 429) throw new TelegramDeliveryError("throttled", retryAfter(body));
    if (response.status >= 500) throw new TelegramDeliveryError("delivery_unknown");
    if (
      (response.status >= 400 && response.status < 500) ||
      (Number(errorCode) >= 400 && Number(errorCode) < 500)
    ) throw new TelegramDeliveryError("rejected");
    if (!response.ok || object(body)?.ok !== true) throw new TelegramDeliveryError("delivery_unknown");
    return object(body)?.result;
  }

  async sendProof(input: SendProofInput): Promise<number> {
    if ((input.callbackToken !== null && !CALLBACK_TOKEN.test(input.callbackToken)) || (input.caption !== null && input.caption.length > CAPTION_LIMIT)) {
      throw new TelegramDeliveryError("rejected");
    }
    const method = proofMethod(input.upload);
    const field = method === "sendPhoto" ? "photo" : "document";
    const form = new FormData();
    form.set("chat_id", this.config.chatId);
    form.set("protect_content", "true");
    form.set(field, input.bytes, input.upload.objectPath.split("/").at(-1) ?? `proof-${input.upload.order}`);
    if (input.caption !== null) form.set("caption", input.caption);
    if (input.replyToMessageId !== null) form.set("reply_to_message_id", String(input.replyToMessageId));
    if (input.callbackToken !== null && input.adminUrl !== null) form.set("reply_markup", JSON.stringify({ inline_keyboard: [[
      { text: "승인", callback_data: input.callbackToken },
      { text: "관리자에서 보기", url: input.adminUrl },
    ]] }));
    const result = object(await this.request(method, { method: "POST", body: form }));
    const messageId = result?.message_id;
    if (!Number.isSafeInteger(messageId) || Number(messageId) <= 0) throw new TelegramDeliveryError("delivery_unknown");
    return messageId as number;
  }

  async answerCallback(queryId: string, text: string, showAlert: boolean): Promise<void> {
    await this.request("answerCallbackQuery", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: queryId, text, show_alert: showAlert }),
    });
  }

  async editApproved(messageId: number, existingCaption: string, displayName: string, adminUrl: string): Promise<void> {
    const suffix = `✅ 승인 완료 · ${sanitize(displayName, 80)}`;
    const caption = `${sanitize(existingCaption, CAPTION_LIMIT - suffix.length - 2)}\n\n${suffix}`;
    await this.request("editMessageCaption", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId, message_id: messageId, caption,
        reply_markup: { inline_keyboard: [[{ text: "관리자에서 보기", url: adminUrl }]] },
      }),
    });
  }
}

function adminUrl(submissionId: string): string {
  return `${ADMIN_CERTIFICATIONS_URL}?status=pending&submission=${submissionId}`;
}

export class TelegramCertificationWorker {
  constructor(
    private readonly queue: TelegramCertificationQueue,
    private readonly storage: TelegramCertificationStorage,
    private readonly sender: TelegramCertificationSender,
    private readonly chatId: string,
  ) {}

  async runOnce(): Promise<number> {
    const claim = await this.queue.claim(this.chatId);
    if (!claim) return 0;
    await this.queue.begin(claim.deliveryId, this.chatId);
    let firstMessageId: number | null = null;
    for (const upload of claim.uploads) {
      let bytes: Blob;
      try { bytes = await this.storage.download(upload.objectPath); }
      catch {
        await this.queue.record(claim.deliveryId, this.chatId, upload.id, upload.order, "rejected", null, null);
        console.error("telegram_certification_delivery", { outcome: "failed", stage: "storage" });
        return 0;
      }
      try {
        const messageId = await this.sender.sendProof({
          upload, bytes,
          caption: upload.order === 1 ? renderTelegramCertificationCaption(claim) : null,
          callbackToken: upload.order === 1 ? claim.callbackToken : null,
          adminUrl: upload.order === 1 ? adminUrl(claim.submissionId) : null,
          replyToMessageId: upload.order === 1 ? null : firstMessageId,
        });
        await this.queue.record(claim.deliveryId, this.chatId, upload.id, upload.order, "sent", messageId, null);
        if (upload.order === 1) firstMessageId = messageId;
      } catch (error) {
        const known = error instanceof TelegramDeliveryError ? error : new TelegramDeliveryError("delivery_unknown");
        await this.queue.record(claim.deliveryId, this.chatId, upload.id, upload.order, known.outcome, null, known.retryAfter ?? null);
        console.error("telegram_certification_delivery", { outcome: known.outcome, stage: upload.order === 1 ? "action" : "attachment" });
        return 0;
      }
    }
    console.info("telegram_certification_delivery", { outcome: "sent", imageCount: claim.uploads.length });
    return 1;
  }
}

export interface TelegramCertificationCallbackHandler {
  handle(callback: TelegramCertificationCallback): Promise<"approved" | "already_processed" | "failed">;
}

export class TelegramCertificationCallbackWorker implements TelegramCertificationCallbackHandler {
  constructor(
    private readonly queue: Pick<Required<TelegramCertificationQueue>, "approve">,
    private readonly api: TelegramCertificationCallbackApi,
    private readonly chatId: string,
  ) {}

  async handle(callback: TelegramCertificationCallback): Promise<"approved" | "already_processed" | "failed"> {
    let approval: TelegramApproval;
    try {
      approval = await this.queue.approve(this.chatId, callback);
    } catch {
      try { await this.api.answerCallback(callback.queryId, "승인 처리에 실패했습니다. 관리자에서 확인해 주세요.", true); } catch { /* cursor must still advance */ }
      console.error("telegram_certification_callback", { outcome: "failed" });
      return "failed";
    }
    const answer = approval.outcome === "approved" ? "승인되었습니다." : "이미 처리된 인증입니다.";
    try { await this.api.answerCallback(callback.queryId, answer, false); } catch { /* approval remains final */ }
    try { await this.api.editApproved(callback.messageId, callback.caption, callback.displayName, adminUrl(approval.submissionId)); } catch { /* edit failure never rolls approval back */ }
    console.info("telegram_certification_callback", { outcome: approval.outcome });
    return approval.outcome;
  }
}

export function validatedTelegramCertificationConfig(env: NotificationWorkerEnv): { token: string; chatId: string } | null {
  const config = validatedTelegramConfig(env, env.telegram.certificationReviewMode, "TELEGRAM_CERTIFICATION_CONFIG_INVALID");
  if (!config) return null;
  if (env.telegram.mode !== "enabled" || env.telegram.commandMode !== "enabled") {
    throw new Error("TELEGRAM_CERTIFICATION_CONFIG_INVALID");
  }
  validatedTelegramConfig(env, env.telegram.mode, "TELEGRAM_CERTIFICATION_CONFIG_INVALID");
  validatedTelegramConfig(env, env.telegram.commandMode, "TELEGRAM_CERTIFICATION_CONFIG_INVALID");
  return config;
}

export async function runTelegramCertificationWorkerOnce(env: NotificationWorkerEnv): Promise<number> {
  const config = validatedTelegramCertificationConfig(env);
  if (!config) return 0;
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }) },
  });
  const queue = new SupabaseTelegramCertificationQueue(db);
  const processed = await new TelegramCertificationWorker(queue, new SupabaseCertificationStorage(db), new TelegramCertificationHttpClient(config), config.chatId).runOnce();
  console.info("telegram_certification_health", await queue.health());
  return processed;
}

export function createTelegramCertificationCallbackWorker(env: NotificationWorkerEnv): TelegramCertificationCallbackWorker | null {
  const config = validatedTelegramCertificationConfig(env);
  if (!config) return null;
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }) },
  });
  return new TelegramCertificationCallbackWorker(new SupabaseTelegramCertificationQueue(db) as Pick<Required<TelegramCertificationQueue>, "approve">, new TelegramCertificationHttpClient(config), config.chatId);
}
