import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NotificationWorkerEnv } from "./notification-env.js";

const ADMIN_URL = "https://byus.kr/admin";
const ADMIN_INQUIRY_URL = `${ADMIN_URL}/inquiries`;
const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 8_000;
const TELEGRAM_MESSAGE_LIMIT = 4_000;
const TELEGRAM_BATCH_LIMIT = 5;
const SITE_URL = "https://byus.kr";
const PROD_SUPABASE_HOST = "gmrykvmtmuaeswpajteq.supabase.co";
const BOT_TOKEN = /^[1-9]\d{5,11}:[A-Za-z0-9_-]{35}$/;
const GROUP_OR_CHANNEL_CHAT_ID = /^-[1-9]\d{5,19}$/;

const activityLabels = {
  "fan_post_created": [
    "팬 게시글 작성",
    "celebrities"
  ],
  "fan_post_commented": [
    "팬 게시글 댓글 작성",
    "celebrities"
  ],
  "fan_post_liked": [
    "팬 게시글 좋아요",
    "celebrities"
  ],
  "fan_lounge_posted": [
    "응원글 작성",
    "celebrities"
  ],
  "notice_commented": [
    "공지 댓글 작성",
    "celebrities"
  ],
  "daily_checked_in": [
    "일일 출석 체크",
    "celebrities"
  ],
  "raffle_entered": [
    "응모 접수",
    "benefits"
  ],
  "benefit_claimed": [
    "혜택 수령",
    "benefits"
  ],
  "reaction_completed": [
    "팬 리액션 완료",
    "celebrities"
  ],
  "mission_submitted": [
    "미션 제출",
    "lives"
  ],
  "journey_completed": [
    "LIVE 여정 완료",
    "lives"
  ],
  "collectible_claimed": [
    "컬렉터블 수령",
    "lives"
  ],
  "invite_redeemed": [
    "커뮤니티 초대 참여",
    "celebrities"
  ],
  "certification_approved": [
    "팬 인증 승인",
    "certifications"
  ],
  "certification_rejected": [
    "팬 인증 반려",
    "certifications"
  ],
  "fulfillment_updated": [
    "경품 전달 상태 변경",
    "benefits"
  ],
  "fulfillment_unclaimed": [
    "미수령 경품 마감",
    "benefits"
  ],
  "business_received": [
    "사업 문의 접수 · 담당 메일함 확인",
    "system"
  ],
  "business_failed": [
    "⚠️ 사업 문의 메일 전송 실패/결과 불명",
    "system"
  ],
  "mint_completed": [
    "온체인 발급 완료",
    "blockchain-jobs"
  ],
  "mint_failed": [
    "⚠️ 온체인 발급 최종 실패",
    "blockchain-jobs"
  ],
  "delivery_failed": [
    "⚠️ 팬 알림 전송 확인 필요",
    "notifications"
  ],
  "live_published": [
    "LIVE 공개",
    "lives"
  ],
  "live_cancelled": [
    "LIVE 취소 공지",
    "lives"
  ],
  "live_rescheduled": [
    "LIVE 일정 변경",
    "lives"
  ],
  "campaign_outbound": [
    "뱅크시 외부 링크 이동 요청",
    "campaigns"
  ],
  "byus_day_rsvp_received": [
    "ByUs Day RSVP 접수",
    "system"
  ]
} as const;
type ActivityKind = keyof typeof activityLabels;

const kindSchema = z.enum([
  "member_joined",
  "fan_joined",
  "live_reserved",
  "live_attended",
  "draw_published",
  "cs_inquiry_created",
  "cs_user_replied",
  "campaign_visited",
  "raffle_entered",
  "benefit_claimed",
  "reaction_completed",
  "mission_submitted",
  "journey_completed",
  "collectible_claimed",
  "invite_redeemed",
  "certification_approved",
  "certification_rejected",
  "fulfillment_updated",
  "fulfillment_unclaimed",
  "business_received",
  "business_failed",
  "mint_completed",
  "mint_failed",
  "delivery_failed",
  "live_published",
  "live_cancelled",
  "live_rescheduled",
  "campaign_outbound",
  "fan_post_created",
  "fan_post_commented",
  "fan_post_liked",
  "fan_lounge_posted",
  "notice_commented",
  "daily_checked_in",
  "byus_day_rsvp_received",
]);
const detailKinds = new Set<string>([
  "member_joined",
  "fan_joined",
  "live_reserved",
  "live_attended",
  "fan_post_created",
  "fan_post_commented",
  "fan_post_liked",
  "fan_lounge_posted",
  "notice_commented",
  "daily_checked_in",
  "raffle_entered",
  "benefit_claimed",
  "reaction_completed",
  "mission_submitted",
  "journey_completed",
  "collectible_claimed",
  "invite_redeemed",
  "certification_approved",
  "certification_rejected",
]);
const safeDetailPath = z.string().max(500).refine((path) =>
  path.startsWith("/") &&
  !path.includes("//") &&
  !path.includes("\\") &&
  !/[\u0000-\u0020\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(path),
);
const detailFields = {
  recipient_id: z.uuid().nullable(),
  recipient_name: z.string().nullable(),
  creator_name: z.string().nullable(),
  context: z.string().nullable(),
  body: z.string().max(10_000).nullable(),
  path: safeDetailPath,
  result: z.string().nullable(),
  is_reply: z.boolean(),
};
const detailSchema = z.union([
  z.object({ actor_id: z.uuid(), ...detailFields }).strict(),
  z.object({
    actor_id: z.null(),
    telegram_actor_id: z.string().regex(/^[1-9]\d{0,19}$/u),
    telegram_username: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/u).nullable(),
    ...detailFields,
  }).strict(),
]);
const alertSchema = z.object({
  kind: kindSchema,
  creator_name: z.string().nullable(),
  live_title: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_email: z.string().nullable(),
  winner_count: z.number().int().nonnegative().nullable(),
  occurred_at: z.iso.datetime({ offset: true }),
  inquiry_id: z.uuid().nullable().optional(),
  campaign_name: z.string().min(1).max(80).optional(),
  campaign_channel: z.string().min(1).max(40).optional(),
  activity_context: z.string().max(320).nullable().optional(),
  activity_quantity: z.number().int().nonnegative().nullable().optional(),
  rsvp: z.object({
    affiliation: z.string().min(1).max(240),
    occupation: z.string().min(1).max(240),
  }).strict().optional(),
  detail: detailSchema.optional(),
  // PostgreSQL permits 4000 Unicode characters, up to 8000 UTF-16 units.
  message_body: z.string().min(1).max(8000).nullable().optional(),
}).strict().superRefine((alert, context) => {
  if (alert.rsvp !== undefined && alert.kind !== "byus_day_rsvp_received") {
    context.addIssue({ code: "custom", message: "unexpected RSVP details" });
  }
  if (alert.kind in activityLabels) {
    if (alert.activity_context === undefined || alert.activity_quantity === undefined ||
      [alert.creator_name, alert.live_title, alert.winner_count].some(value => value !== null) ||
      (!alert.detail && [alert.actor_name, alert.actor_email].some(value => value !== null))) {
      context.addIssue({ code: "custom", message: "invalid activity payload" });
    }
  } else if (alert.activity_context !== undefined || alert.activity_quantity !== undefined) {
    context.addIssue({ code: "custom", message: "unexpected activity context" });
  }
  if (alert.kind === "campaign_visited") {
    if (!alert.campaign_name || !alert.campaign_channel) {
      context.addIssue({ code: "custom", message: "missing campaign context" });
    }
    if ([alert.creator_name, alert.live_title, alert.actor_name, alert.actor_email, alert.winner_count].some(value => value !== null)) {
      context.addIssue({ code: "custom", message: "unexpected campaign identity" });
    }
  } else if (alert.campaign_name !== undefined || alert.campaign_channel !== undefined) {
    context.addIssue({ code: "custom", message: "unexpected campaign context" });
  }
  if (alert.kind === "draw_published" && alert.winner_count === null) {
    context.addIssue({ code: "custom", path: ["winner_count"], message: "missing draw winner count" });
  }
  const isCsAlert = alert.kind === "cs_inquiry_created" || alert.kind === "cs_user_replied";
  if (isCsAlert && alert.message_body == null) {
    context.addIssue({ code: "custom", path: ["message_body"], message: "missing CS message body" });
  }
  if (!isCsAlert && alert.message_body != null) {
    context.addIssue({ code: "custom", path: ["message_body"], message: "unexpected message body" });
  }
  if (isCsAlert && alert.inquiry_id == null) {
    context.addIssue({ code: "custom", path: ["inquiry_id"], message: "missing CS inquiry id" });
  }
  if (!isCsAlert && alert.inquiry_id != null) {
    context.addIssue({ code: "custom", path: ["inquiry_id"], message: "unexpected inquiry id" });
  }
  if (isCsAlert) {
    for (const field of ["creator_name", "live_title", "actor_name", "actor_email", "winner_count"] as const) {
      if (alert[field] !== null) {
        context.addIssue({ code: "custom", path: [field], message: "unexpected CS alert content" });
      }
    }
  }
  if (alert.detail && !detailKinds.has(alert.kind)) {
    context.addIssue({ code: "custom", path: ["detail"], message: "unexpected activity detail" });
  }
  if (alert.detail?.actor_id === null &&
    (alert.kind !== "certification_approved" || alert.actor_name === null || alert.actor_email !== null)) {
    context.addIssue({ code: "custom", path: ["detail"], message: "invalid Telegram actor" });
  }
});
const claimedBatchSchema = z.object({
  batch_id: z.uuid(),
  alerts: z.array(alertSchema).min(1).max(TELEGRAM_BATCH_LIMIT),
}).strict();

export type TelegramAlertSnapshot = z.infer<typeof alertSchema>;
export interface TelegramAlertBatch {
  batchId: string;
  alerts: TelegramAlertSnapshot[];
}
export type TelegramAlertOutcome = "sent" | "throttled" | "rejected" | "unknown";

function cleanPublicName(value: string | null, maxLength: number): string {
  if (!value) return "";
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (clean.length <= maxLength) return clean;
  let prefix = clean.slice(0, maxLength - 1);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix.trimEnd()}…`;
}

function publicContext(creatorName: string, liveTitle: string): string {
  return [creatorName, liveTitle].filter(Boolean).join(" · ");
}

function cleanDetailText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, "");
}

function kstTimestamp(value: string): string {
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1_000)
    .toISOString().slice(0, 19).replace("T", " ") + " KST";
}

function detailLabel(alert: TelegramAlertSnapshot): string {
  if (!alert.detail?.is_reply) return activityLabels[alert.kind as ActivityKind]?.[0] ?? ({
    member_joined: "신규 회원 가입",
    fan_joined: "팬 가입",
    live_reserved: "LIVE 예약",
    live_attended: "LIVE 출석",
  } as const)[alert.kind as "member_joined" | "fan_joined" | "live_reserved" | "live_attended"] ?? "주요 활동";
  if (alert.kind === "fan_post_commented") return "팬 게시글 답글 작성";
  if (alert.kind === "fan_lounge_posted") return "응원글 답글 작성";
  if (alert.kind === "notice_commented") return "공지 답글 작성";
  return activityLabels[alert.kind as ActivityKind]?.[0] ?? "주요 활동";
}

function quotedBody(value: string, truncated: boolean): string[] {
  const lines = value.split("\n").map((line) => `│${line}`);
  if (truncated) lines.push("│… (본문 일부 생략)");
  return ["  내용:", ...lines];
}

function safePrefix(value: string, length: number): string {
  let prefix = value.slice(0, length);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return prefix;
}

function renderDetailedAlert(alert: TelegramAlertSnapshot, body: string | null, truncated = false): string[] {
  const detail = alert.detail!;
  const actorName = cleanPublicName(alert.actor_name, 48) || "닉네임 미설정";
  const actorEmail = cleanPublicName(alert.actor_email, 320) || "이메일 미등록";
  const recipientName = cleanPublicName(detail.recipient_name, 48);
  const creatorName = cleanPublicName(detail.creator_name, 120);
  const context = cleanPublicName(detail.context, 160);
  const result = cleanPublicName(detail.result, 160);
  const telegramActor = detail.actor_id === null;
  const telegramUsername = telegramActor && detail.telegram_username ? ` · @${detail.telegram_username}` : "";
  return [
    `• ${detailLabel(alert)}`,
    ...(telegramActor
      ? [`  활동자: ${actorName}${telegramUsername}`, `  Telegram ID: ${detail.telegram_actor_id}`]
      : [`  활동자: ${actorName} · ${actorEmail}`, `  활동자 ID: ${detail.actor_id}`]),
    ...(recipientName || detail.recipient_id ? [`  대상: ${recipientName || "이름 미설정"}`] : []),
    ...(detail.recipient_id ? [`  대상 ID: ${detail.recipient_id}`] : []),
    ...(creatorName ? [`  크리에이터: ${creatorName}`] : []),
    ...(context ? [`  대상 내용: ${context}`] : []),
    ...(body === null ? [] : quotedBody(body, truncated)),
    ...(result ? [`  결과: ${result}`] : []),
    `  시각: ${kstTimestamp(alert.occurred_at)}`,
    `${SITE_URL}${detail.path}`,
  ];
}

function detailedMessage(input: readonly TelegramAlertSnapshot[]): string | null {
  if (!input.some((alert) => alert.detail)) return null;
  if (input.filter((alert) => alert.detail).some((alert) => !alertSchema.safeParse(alert).success)) {
    throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
  }
  const bodies = input.map((alert) => alert.detail?.body == null ? null : cleanDetailText(alert.detail.body));
  const render = (currentBodies: readonly (string | null)[], truncated: ReadonlySet<number>) => [
    "🎉 ByUs 주요 소식",
    "",
    ...input.flatMap((alert, index) => alert.detail
      ? renderDetailedAlert(alert, currentBodies[index] ?? null, truncated.has(index))
      : renderLegacyAlert(alert)),
    "",
    "관리자에서 확인하기",
    ADMIN_URL,
  ].join("\n");
  const full = render(bodies, new Set());
  if (full.length <= TELEGRAM_MESSAGE_LIMIT) return full;

  const truncatable = input.flatMap((alert, index) =>
    alert.detail?.body != null && ["fan_post_created", "fan_post_liked", "fan_lounge_posted"].includes(alert.kind) ? [index] : []);
  if (truncatable.length === 0) throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
  const currentBodies = [...bodies];
  const truncated = new Set(truncatable);
  for (const index of truncatable) currentBodies[index] = "";
  if (render(currentBodies, truncated).length > TELEGRAM_MESSAGE_LIMIT) throw new Error("TELEGRAM_ALERT_INVALID_BATCH");

  for (let position = 0; position < truncatable.length; position += 1) {
    const index = truncatable[position]!;
    const source = bodies[index]!;
    const available = TELEGRAM_MESSAGE_LIMIT - render(currentBodies, truncated).length;
    const share = Math.floor(available / (truncatable.length - position));
    let low = 0;
    let high = source.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      currentBodies[index] = safePrefix(source, middle);
      const added = render(currentBodies, truncated).length - (TELEGRAM_MESSAGE_LIMIT - available);
      if (added <= share) low = middle;
      else high = middle - 1;
    }
    currentBodies[index] = safePrefix(source, low);
    if (low === source.length) truncated.delete(index);
  }
  const message = render(currentBodies, truncated);
  if (message.length > TELEGRAM_MESSAGE_LIMIT) throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
  return message;
}

function renderLegacyAlert(alert: TelegramAlertSnapshot): string[] {
  if (alert.kind in activityLabels) {
    alertSchema.parse(alert);
    const [label, page] = activityLabels[alert.kind as ActivityKind];
    const context = cleanPublicName(alert.activity_context ?? null, alert.kind === "byus_day_rsvp_received" ? 200 : 160);
    if (alert.kind === "byus_day_rsvp_received") {
      return [`• ${label}`,
        ...(context && !/^누적 \d+명$/u.test(context) ? [`  접수자: ${context}`] : []),
        ...(alert.rsvp ? [
          `  소속: ${cleanPublicName(alert.rsvp.affiliation, 120)}`,
          `  직책: ${cleanPublicName(alert.rsvp.occupation, 120)}`,
        ] : []),
        `  누적 ${alert.activity_quantity ?? 0}명`, `${ADMIN_URL}/${page}`];
    }
    return [`• ${label}`, ...(context ? [`  ${context}`] : []),
      ...(alert.kind === "raffle_entered" ? [`  사용 응모권 ${alert.activity_quantity ?? 0}장`] : []), `${ADMIN_URL}/${page}`];
  }
  if (alert.kind === "campaign_visited") {
    return ["• 캠페인 링크로 새 방문", `  ${cleanPublicName(alert.campaign_name ?? null, 80)}`, `  채널: ${cleanPublicName(alert.campaign_channel ?? null, 40)} · 브라우저 세션 1건`, `${ADMIN_URL}/campaigns`];
  }
  if (alert.kind === "cs_inquiry_created" || alert.kind === "cs_user_replied") {
    const inquiryId = z.uuid().safeParse(alert.inquiry_id);
    if (!inquiryId.success) throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
    const event = alert.kind === "cs_inquiry_created" ? "새 CS 문의 접수" : "CS 문의에 새 메시지";
    const preview = cleanPublicName(alert.message_body ?? null, 600);
    return [`• ${event}`, `내용: ${preview}`, `${ADMIN_INQUIRY_URL}/${inquiryId.data}`];
  }
  const creatorName = cleanPublicName(alert.creator_name, 48);
  const liveTitle = cleanPublicName(alert.live_title, 72);
  const context = publicContext(creatorName, liveTitle);
  const prefix = context ? `${context} ` : "";
  if (alert.kind === "draw_published") return [`• ${prefix}추첨 결과 공개 · 당첨 ${alert.winner_count ?? 0}명`];
  const actorName = cleanPublicName(alert.actor_name, 48) || "닉네임 미설정";
  const actorEmail = cleanPublicName(alert.actor_email, 320) || "이메일 미등록";
  let event: string = "주요 활동";
  switch (alert.kind) {
    case "member_joined": event = "신규 회원 가입"; break;
    case "fan_joined": event = `${prefix}팬 가입`; break;
    case "live_reserved": event = `${prefix}예약`; break;
    case "live_attended": event = `${prefix}출석`; break;
  }
  return [`• ${event}`, `  ${actorName}`, `  ${actorEmail}`];
}

export function renderTelegramAlertMessage(input: readonly TelegramAlertSnapshot[]): string {
  if (input.length < 1 || input.length > TELEGRAM_BATCH_LIMIT) {
    throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
  }
  const detail = detailedMessage(input);
  if (detail) return detail;
  const lines = input.flatMap(renderLegacyAlert);
  const message = [
    "🎉 ByUs 주요 소식",
    "",
    ...lines,
    "",
    "관리자에서 확인하기",
    ADMIN_URL,
  ].join("\n");
  if (message.length > TELEGRAM_MESSAGE_LIMIT) throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
  return message;
}

export class TelegramSendError extends Error {
  constructor(
    readonly outcome: Exclude<TelegramAlertOutcome, "sent">,
    readonly retryAfter: number | undefined = undefined,
  ) {
    super(`TELEGRAM_SEND_${outcome.toUpperCase()}`);
  }
}

export interface TelegramAlertSender {
  sendText(text: string): Promise<bigint>;
}

type Fetch = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function retryAfterFrom(body: unknown): number {
  const raw = record(record(body)?.parameters)?.retry_after;
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 60;
  return Math.max(1, Math.min(86_400, seconds));
}

export class TelegramHttpSender implements TelegramAlertSender {
  constructor(
    private readonly config: { token: string; chatId: string },
    private readonly fetcher: Fetch = fetch,
  ) {}

  async sendText(text: string): Promise<bigint> {
    if (!text || text.length > TELEGRAM_MESSAGE_LIMIT || /[\u0000]/u.test(text)) {
      throw new TelegramSendError("rejected");
    }
    let response: Response;
    try {
      response = await this.fetcher(
        `${TELEGRAM_API_ORIGIN}/bot${this.config.token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
          body: JSON.stringify({
            chat_id: this.config.chatId,
            text,
            link_preview_options: { is_disabled: true },
          }),
        },
      );
    } catch {
      throw new TelegramSendError("unknown");
    }

    let body: unknown = null;
    try { body = await response.json(); } catch { /* malformed responses are unknown */ }
    const parsed = record(body);
    const errorCode = parsed?.error_code;
    if (response.status === 429 || errorCode === 429) {
      throw new TelegramSendError("throttled", retryAfterFrom(body));
    }
    if (response.status >= 500) throw new TelegramSendError("unknown");
    if ([400, 401, 403].includes(response.status) || [400, 401, 403].includes(Number(errorCode))) {
      throw new TelegramSendError("rejected");
    }
    if (!response.ok || !parsed || parsed.ok !== true) {
      throw new TelegramSendError("unknown");
    }
    const messageId = record(parsed.result)?.message_id;
    if (!Number.isSafeInteger(messageId) || Number(messageId) <= 0) {
      throw new TelegramSendError("unknown");
    }
    return BigInt(messageId as number);
  }
}

export interface TelegramAlertQueue {
  claim(chatId: string): Promise<TelegramAlertBatch | null>;
  begin(batchId: string, chatId: string): Promise<boolean>;
  finish(
    batchId: string,
    outcome: TelegramAlertOutcome,
    providerMessageId: bigint | null,
    retryAfter: number | null,
  ): Promise<void>;
}

type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export class SupabaseTelegramAlertQueue implements TelegramAlertQueue {
  constructor(private readonly db: RpcClient) {}

  private async call(name: string, args?: Record<string, unknown>): Promise<unknown> {
    let result: { data: unknown; error: unknown };
    try { result = await this.db.rpc(name, args); }
    catch { throw new Error("TELEGRAM_ALERT_QUEUE_UNAVAILABLE"); }
    const { data, error } = result;
    if (error) throw new Error("TELEGRAM_ALERT_QUEUE_UNAVAILABLE");
    return data;
  }

  async claim(chatId: string): Promise<TelegramAlertBatch | null> {
    const data = await this.call("claim_telegram_alert_batch_with_cs_content", { p_chat_id: chatId });
    if (data === null) return null;
    const parsed = claimedBatchSchema.safeParse(data);
    if (!parsed.success) throw new Error("TELEGRAM_ALERT_INVALID_BATCH");
    return { batchId: parsed.data.batch_id, alerts: parsed.data.alerts };
  }

  async begin(batchId: string, chatId: string): Promise<boolean> {
    const data = await this.call("begin_telegram_alert_send", {
      p_batch_id: batchId,
      p_chat_id: chatId,
    });
    if (typeof data !== "boolean") throw new Error("TELEGRAM_ALERT_QUEUE_UNAVAILABLE");
    return data;
  }

  async finish(
    batchId: string,
    outcome: TelegramAlertOutcome,
    providerMessageId: bigint | null,
    retryAfter: number | null,
  ): Promise<void> {
    const data = await this.call("finish_telegram_alert_batch", {
      p_batch_id: batchId,
      p_outcome: outcome,
      p_provider_message_id: providerMessageId === null ? null : Number(providerMessageId),
      p_retry_after: retryAfter,
    });
    if (data !== true) throw new Error("TELEGRAM_ALERT_QUEUE_UNAVAILABLE");
  }
}

export class TelegramAlertWorker {
  constructor(
    private readonly queue: TelegramAlertQueue,
    private readonly sender: TelegramAlertSender,
    private readonly chatId: string,
  ) {}

  async runOnce(): Promise<number> {
    const batch = await this.queue.claim(this.chatId);
    if (!batch) return 0;
    const text = renderTelegramAlertMessage(batch.alerts);
    if (!await this.queue.begin(batch.batchId, this.chatId)) return 0;
    let providerMessageId: bigint;
    try {
      providerMessageId = await this.sender.sendText(text);
    } catch (error) {
      const known = error instanceof TelegramSendError ? error : new TelegramSendError("unknown");
      await this.queue.finish(batch.batchId, known.outcome, null, known.retryAfter ?? null);
      return 0;
    }
    await this.queue.finish(batch.batchId, "sent", providerMessageId, null);
    return batch.alerts.length;
  }
}

export function validatedTelegramConfig(
  env: NotificationWorkerEnv,
  mode = env.telegram.mode,
  errorCode = "TELEGRAM_ALERT_CONFIG_INVALID",
): { token: string; chatId: string } | null {
  const raw = env.telegram;
  if (mode === undefined || mode === "disabled") return null;
  if (
    mode !== "enabled" ||
    env.NOTIFICATION_EXTERNAL_ENVIRONMENT !== "prod" ||
    new URL(env.SUPABASE_URL).hostname !== PROD_SUPABASE_HOST ||
    !raw.token || !BOT_TOKEN.test(raw.token) ||
    !raw.chatId || !GROUP_OR_CHANNEL_CHAT_ID.test(raw.chatId)
  ) throw new Error(errorCode);
  return { token: raw.token, chatId: raw.chatId };
}

export function createTelegramSender(env: NotificationWorkerEnv, fetcher: Fetch = fetch): TelegramHttpSender | null {
  const config = validatedTelegramConfig(env);
  return config ? new TelegramHttpSender(config, fetcher) : null;
}

export async function sendTelegramText(env: NotificationWorkerEnv, text: string): Promise<bigint> {
  const sender = createTelegramSender(env);
  if (!sender) throw new Error("TELEGRAM_ALERT_DISABLED");
  return sender.sendText(text);
}

export async function runTelegramAlertWorkerOnce(
  env: NotificationWorkerEnv,
  dependencies: { queue?: TelegramAlertQueue; sender?: TelegramAlertSender } = {},
): Promise<number> {
  const config = validatedTelegramConfig(env);
  if (!config) return 0;
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }),
    },
  });
  const queue = dependencies.queue ?? new SupabaseTelegramAlertQueue(db);
  const sender = dependencies.sender ?? new TelegramHttpSender(config);
  return new TelegramAlertWorker(queue, sender, config.chatId).runOnce();
}
