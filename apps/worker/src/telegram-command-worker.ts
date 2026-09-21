import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NotificationWorkerEnv } from "./notification-env.js";
import {
  TelegramHttpSender,
  TelegramSendError,
  validatedTelegramConfig,
  type TelegramAlertSender,
} from "./telegram-alert-worker.js";
import {
  createTelegramCertificationCallbackWorker,
  validatedTelegramCertificationConfig,
  type TelegramCertificationCallback,
  type TelegramCertificationCallbackHandler,
} from "./telegram-certification-worker.js";

const BOT_USERNAME = "sallylabsurveyalertbot";
const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const MAX_REPLIES = 3;
const RUN_DEADLINE_MS = 40_000;
const REQUIRED_REPLY_BUDGET_MS = 18_000;
const REQUIRED_CALLBACK_BUDGET_MS = 26_000;

const commandSchema = z.enum(["users", "today", "lives", "ops", "marketing", "help"]);
export type TelegramCommand = z.infer<typeof commandSchema>;
export interface TelegramCommandRequest {
  updateId: number;
  command: TelegramCommand;
  messageDate: number;
}
export type TelegramClassifiedUpdate = {
  updateId: number;
  request: TelegramCommandRequest | null;
};

const count = z.number().int().nonnegative();
const generated = z.iso.datetime({ offset: true });
const helpPayload = z.object({ command: z.literal("help"), generated_at: generated }).strict();
const usersPayload = z.object({
  command: z.literal("users"), generated_at: generated,
  total_users: count, active_users: count, disabled_users: count,
  passport_users: count, passport_count: count,
}).strict();
const todayPayload = z.object({
  command: z.literal("today"), generated_at: generated, date: z.iso.date(),
  signups: count, fan_joins: count, reservations: count, attendances: count,
}).strict();
const liveSchema = z.object({
  creator_name: z.string(), title: z.string(), starts_at: generated,
  reservations: count, attendances: count,
}).strict();
const livesPayload = z.object({
  command: z.literal("lives"), generated_at: generated,
  lives: z.array(liveSchema).max(5), total_lives: count,
}).strict();
const opsPayload = z.object({
  command: z.literal("ops"), generated_at: generated,
  pending_cs: count, pending_certifications: count, failed_mints: count, overdue_mints: count,
  failed_deliveries: count, business_pending: count, business_failed: count,
  telegram_pending: count, telegram_failed: count, telegram_unknown: count,
  telegram_oldest_pending_at: generated.nullable(),
}).strict();
const marketingCounts = z.object({
  accounts: count, profile_accounts: count, passport_accounts: count, reactions: count,
  missions: count, raffle_entries: count, raffle_tickets: count, invite_redemptions: count,
  tracked_visits: count, direct_visits: count, outbound_sessions: count,
}).strict();
const marketingPayload = z.object({
  command: z.literal("marketing"), generated_at: generated, from: generated, previous_from: generated,
  current: marketingCounts, previous: marketingCounts, active_links: count,
  campaign_sources: z.array(z.object({ name: z.string().max(160), channel: z.string().max(80),
    visits: count, outbound_sessions: count }).strict()).max(5),
}).strict();
const payloadSchema = z.discriminatedUnion("command", [helpPayload, usersPayload, todayPayload, livesPayload, opsPayload, marketingPayload]);
export type TelegramCommandPayload = z.infer<typeof payloadSchema>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function classifyTelegramUpdate(value: unknown, chatId: string): TelegramClassifiedUpdate | null {
  const update = record(value);
  const updateId = update?.update_id;
  if (!Number.isSafeInteger(updateId) || Number(updateId) < 0) return null;
  const ignored = { updateId: updateId as number, request: null };
  const message = record(update?.message);
  if (!message) return ignored;
  const from = record(message.from);
  const chat = record(message.chat);
  if (!from || from.is_bot !== false || String(chat?.id) !== chatId) return ignored;
  const text = message.text;
  if (typeof text !== "string") return ignored;
  const entities = Array.isArray(message.entities) ? message.entities : [];
  const entity = entities.map(record).find((item) => item?.type === "bot_command" && item.offset === 0);
  const length = entity?.length;
  if (!Number.isInteger(length) || Number(length) <= 0 || text.length !== length) return ignored;
  const token = text.slice(0, Number(length));
  const match = /^\/([a-z]+)(?:@([A-Za-z0-9_]+))?$/u.exec(token);
  if (!match || (match[2] && match[2].toLowerCase() !== BOT_USERNAME)) return ignored;
  const name = match[1] === "start" ? "help" : match[1];
  const parsed = commandSchema.safeParse(name);
  const messageDate = message.date;
  if (!parsed.success || !Number.isSafeInteger(messageDate) || Number(messageDate) < 0) return ignored;
  return { updateId: updateId as number, request: { updateId: updateId as number, command: parsed.data, messageDate: messageDate as number } };
}

export function classifyTelegramCallbackUpdate(value: unknown, chatId: string): TelegramCertificationCallback | null {
  const update = record(value);
  const updateId = update?.update_id;
  if (!Number.isSafeInteger(updateId) || Number(updateId) < 0) return null;
  const query = record(update?.callback_query);
  const from = record(query?.from);
  const message = record(query?.message);
  const chat = record(message?.chat);
  const queryId = query?.id;
  const callbackToken = query?.data;
  const telegramUserId = from?.id;
  const messageId = message?.message_id;
  if (
    !query || !from || from.is_bot !== false ||
    typeof queryId !== "string" || queryId.length < 1 || queryId.length > 256 ||
    typeof callbackToken !== "string" || !/^[0-9a-f]{32}$/u.test(callbackToken) || new TextEncoder().encode(callbackToken).length > 64 ||
    !Number.isSafeInteger(telegramUserId) || Number(telegramUserId) <= 0 ||
    !message || !Number.isSafeInteger(messageId) || Number(messageId) <= 0 ||
    !chat || !["group", "supergroup"].includes(String(chat.type)) || String(chat.id) !== chatId
  ) return null;
  const firstName = typeof from.first_name === "string" ? bounded(from.first_name, 80) : "";
  const lastName = typeof from.last_name === "string" ? bounded(from.last_name, 80) : "";
  const displayName = bounded([firstName, lastName].filter(Boolean).join(" "), 120);
  if (!displayName) return null;
  const username = typeof from.username === "string" && /^[A-Za-z0-9_]{5,32}$/u.test(from.username) ? from.username : null;
  return {
    updateId: updateId as number,
    queryId,
    callbackToken,
    telegramUserId: telegramUserId as number,
    displayName,
    username,
    messageId: messageId as number,
    caption: typeof message.caption === "string" ? bounded(message.caption, 1_024) : "📸 인증 검토",
  };
}

function bounded(value: string, limit: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ").replace(/\s+/gu, " ").trim();
  if (clean.length <= limit) return clean;
  let prefix = clean.slice(0, limit - 1);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix.trimEnd()}…`;
}

function seoulTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}. ${part("month")}. ${part("day")}. ${part("hour")}:${part("minute")}`;
}

export function renderTelegramCommandReply(raw: TelegramCommandPayload): string {
  const payload = payloadSchema.parse(raw);
  let message: string;
  switch (payload.command) {
    case "help": message = [
      "🤖 ByUs 관리자 명령어",
      "/users 회원 현황",
      "/today 오늘 가입·팬 가입·예약·출석",
      "/lives 공개 라이브 현황",
      "/ops 운영 대기·실패 현황",
      "/marketing 최근 7일 성과·확인할 지점",
      "/help 명령어 안내",
    ].join("\n"); break;
    case "ops": message = [
      `🛠 운영 현황 · ${seoulTime(payload.generated_at)} KST`,
      `CS 답변 대기 ${payload.pending_cs}건 · 인증 검토 대기 ${payload.pending_certifications}건`,
      `발급 최종 실패 ${payload.failed_mints}건 · 예정 시각보다 30분 이상 늦은 대기/재시도 ${payload.overdue_mints}건`,
      `팬 알림 최종 실패/결과 불명 ${payload.failed_deliveries}건 (푸시 전달 + 외부 전송 계획)`,
      `사업 문의 메일 대기 ${payload.business_pending}건 · 실패/결과 불명 ${payload.business_failed}건`,
      `Telegram 대기/전송 중 ${payload.telegram_pending}건 · 거절 ${payload.telegram_failed}건 · 결과 불명 ${payload.telegram_unknown}건`,
      `가장 오래된 대기: ${payload.telegram_oldest_pending_at ? seoulTime(payload.telegram_oldest_pending_at) + " KST" : "없음"}`,
      "현재 DB 상태이며 워커 가동을 보증하지 않습니다. Telegram 완료 이력은 30일 보관합니다.",
      "https://byus.kr/admin/inquiries", "https://byus.kr/admin/certifications",
      "https://byus.kr/admin/blockchain-jobs", "https://byus.kr/admin/notifications", "https://byus.kr/admin/system",
    ].join("\n"); break;
    case "marketing": {
      const c = payload.current, p = payload.previous;
      const compare = (label: string, current: number, previous: number) => `${label} ${current} · 이전 ${previous} (${current - previous >= 0 ? "+" : ""}${current - previous})`;
      const ratio = (part: number, total: number) => total === 0 ? "—" : `${(part / total * 100).toFixed(1)}%`;
      const next = payload.active_links === 0 ? "출처별 링크를 만들어 유입을 측정하세요."
        : c.tracked_visits === 0 ? "추적 유입이 없습니다. 링크 게시 위치와 실제 이동을 확인하세요."
        : c.accounts > c.passport_accounts ? "신규 가입자의 팬 패스 발급 단계에서 멈추는 이유를 확인하세요."
        : "같은 콘텐츠에 출처별 링크를 사용해 방문과 외부 이동 비율을 비교해 보세요.";
      message = [
        "📊 마케팅 현황 · 최근 7개 KST 날짜(오늘 진행분 포함)",
        `${seoulTime(payload.from)} ~ ${seoulTime(payload.generated_at)} KST`,
        `이전: ${seoulTime(payload.previous_from)} ~ ${seoulTime(payload.from)} KST · 동일 길이`,
        compare("신규 계정", c.accounts, p.accounts),
        `그중 프로필 ${c.profile_accounts} (${ratio(c.profile_accounts,c.accounts)}) · 팬 패스 ${c.passport_accounts} (${ratio(c.passport_accounts,c.accounts)})`,
        compare("리액션", c.reactions, p.reactions), compare("미션 제출", c.missions, p.missions),
        compare("응모", c.raffle_entries, p.raffle_entries), `사용 응모권 ${c.raffle_tickets}장 · 이전 ${p.raffle_tickets}장`,
        compare("초대 참여", c.invite_redemptions, p.invite_redemptions),
        "뱅크시 익명 브라우저 세션 (회원 수와 별도)",
        compare("추적 링크 방문", c.tracked_visits,p.tracked_visits),
        `그중 외부 이동 요청 ${c.outbound_sessions} (${ratio(c.outbound_sessions,c.tracked_visits)}) · 이전 ${p.outbound_sessions}`,
        `출처 없는 방문 ${c.direct_visits} · 이전 ${p.direct_visits}`,
        ...payload.campaign_sources.map(source => `• ${bounded(source.name,80)} [${bounded(source.channel,40)}] 방문 ${source.visits} → 외부 이동 ${source.outbound_sessions} (${ratio(source.outbound_sessions,source.visits)})`),
        "계정·활동 집계에는 운영/테스트 계정이 포함됩니다. 신규 계정의 프로필·팬 패스는 각 기간 종료 시점 기준입니다.",
        "방문은 사람 수가 아니며, 외부 도착·구매·유입별 응모 전환을 뜻하지 않습니다.",
        `확인/실험 후보: ${next}`, "https://byus.kr/admin/campaigns",
      ].join("\n"); break;
    }
    case "users": message = [
      "👥 회원 현황",
      `전체 ${payload.total_users}명 · 이용 가능한 회원 ${payload.active_users}명 · 이용 중지 회원 ${payload.disabled_users}명`,
      `팬 패스 보유 회원 ${payload.passport_users}명 · 발급 ${payload.passport_count}개`,
    ].join("\n"); break;
    case "today": message = [
      `📅 오늘 현황 · ${payload.date}`,
      `가입 ${payload.signups}명 · 팬 가입 ${payload.fan_joins}건 · 예약 ${payload.reservations}건 · 출석 ${payload.attendances}건`,
    ].join("\n"); break;
    case "lives": message = payload.lives.length === 0
      ? "🎥 공개 라이브 현황 · 총 0개\n조회할 라이브가 없습니다."
      : [`🎥 공개 라이브 현황 · 총 ${payload.total_lives}개${payload.total_lives > payload.lives.length ? ` · ${payload.lives.length}개 표시` : ""}`, ...payload.lives.flatMap((live) => [
        `• ${bounded(live.creator_name, 48)} · ${bounded(live.title, 72)}`,
        `  ${seoulTime(live.starts_at)} · 예약 ${live.reservations}건 · 출석 ${live.attendances}명`,
      ])].join("\n"); break;
  }
  if (message.length > 4_000) throw new Error("TELEGRAM_COMMAND_INVALID_REPLY");
  return message;
}

export type TelegramCommandOutcome = "sent" | "failed" | "delivery_unknown";
export interface TelegramCommandState { lastUpdateId: number; activatedAt: string }
export interface TelegramCommandQueue {
  read(chatId: string): Promise<TelegramCommandState | null>;
  begin(chatId: string, request: TelegramCommandRequest): Promise<TelegramCommandPayload | null>;
  finish(chatId: string, updateId: number, outcome: TelegramCommandOutcome, providerMessageId: number | null): Promise<void>;
  acknowledge(chatId: string, updateId: number): Promise<void>;
}
export interface TelegramUpdatePoller { getUpdates(offset: number): Promise<unknown[]> }

type RpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export class SupabaseTelegramCommandQueue implements TelegramCommandQueue {
  constructor(private readonly db: RpcClient) {}
  private async call(name: string, args?: Record<string, unknown>) {
    try {
      const { data, error } = await this.db.rpc(name, args);
      if (error) throw new Error();
      return data;
    } catch { throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE"); }
  }
  async read(chatId: string) {
    const data = await this.call("read_telegram_command_state", { p_chat_id: chatId });
    if (data === null) return null;
    const parsed = z.object({ last_update_id: count, activated_at: generated }).strict().safeParse(data);
    if (!parsed.success) throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE");
    return { lastUpdateId: parsed.data.last_update_id, activatedAt: parsed.data.activated_at };
  }
  async begin(chatId: string, request: TelegramCommandRequest) {
    const data = await this.call("begin_telegram_command_reply", {
      p_chat_id: chatId, p_update_id: request.updateId, p_command: request.command, p_message_date: request.messageDate,
    });
    if (data === null) return null;
    const parsed = payloadSchema.safeParse(data);
    if (!parsed.success || parsed.data.command !== request.command) throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE");
    return parsed.data;
  }
  async finish(chatId: string, updateId: number, outcome: TelegramCommandOutcome, providerMessageId: number | null) {
    if (await this.call("finish_telegram_command_reply", { p_chat_id: chatId, p_update_id: updateId, p_outcome: outcome, p_provider_message_id: providerMessageId }) !== true)
      throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE");
  }
  async acknowledge(chatId: string, updateId: number) {
    if (await this.call("acknowledge_telegram_command_updates", { p_chat_id: chatId, p_update_id: updateId }) !== true)
      throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE");
  }
}

type Fetch = typeof fetch;
export class TelegramCommandPoller implements TelegramUpdatePoller {
  constructor(private readonly token: string, private readonly fetcher: Fetch = fetch) {}
  async getUpdates(offset: number): Promise<unknown[]> {
    try {
      const response = await this.fetcher(`${TELEGRAM_API_ORIGIN}/bot${this.token}/getUpdates`, {
        method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
        // Telegram persists this filter across calls. Older command-only
        // deployments excluded callbacks, so omitting it silently loses clicks.
        signal: AbortSignal.timeout(4_000), body: JSON.stringify({
          timeout: 1, limit: 10, offset,
          allowed_updates: ["message", "my_chat_member", "callback_query"],
        }),
      });
      const body = record(await response.json());
      if (!response.ok || body?.ok !== true || !Array.isArray(body.result)) throw new Error();
      return body.result;
    } catch { throw new Error("TELEGRAM_COMMAND_POLL_UNAVAILABLE"); }
  }
}

export class TelegramCommandWorker {
  constructor(
    private readonly queue: TelegramCommandQueue,
    private readonly poller: TelegramUpdatePoller,
    private readonly sender: TelegramAlertSender,
    private readonly chatId: string,
    private readonly now: () => number = Date.now,
    private readonly callbacks: TelegramCertificationCallbackHandler | null = null,
  ) {}
  private async acknowledged(updateId: number) {
    try { await this.queue.acknowledge(this.chatId, updateId); }
    catch { throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE"); }
  }
  async runOnce(): Promise<number> {
    const startedAt = this.now();
    let state: TelegramCommandState | null;
    try { state = await this.queue.read(this.chatId); }
    catch { throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE"); }
    if (!state) return 0;
    let updates: unknown[];
    try { updates = await this.poller.getUpdates(state.lastUpdateId + 1); }
    catch { throw new Error("TELEGRAM_COMMAND_POLL_UNAVAILABLE"); }
    const parsedUpdates = updates.map((item) => classifyTelegramUpdate(item, this.chatId));
    if (parsedUpdates.some((item) => item === null)) throw new Error("TELEGRAM_COMMAND_POLL_UNAVAILABLE");
    const classified = (parsedUpdates as TelegramClassifiedUpdate[]).sort((a, b) => a.updateId - b.updateId);
    let attempts = 0;
    let sent = 0;
    for (const item of classified) {
      const callback = classifyTelegramCallbackUpdate(updates.find((raw) => record(raw)?.update_id === item.updateId), this.chatId);
      if (callback) {
        if (RUN_DEADLINE_MS - (this.now() - startedAt) < REQUIRED_CALLBACK_BUDGET_MS) break;
        const outcome = this.callbacks ? await this.callbacks.handle(callback) : "failed";
        await this.acknowledged(item.updateId);
        if (outcome !== "failed") sent += 1;
        continue;
      }
      if (attempts >= MAX_REPLIES) break;
      if (!item.request) { await this.acknowledged(item.updateId); continue; }
      if (RUN_DEADLINE_MS - (this.now() - startedAt) < REQUIRED_REPLY_BUDGET_MS) break;
      let payload: TelegramCommandPayload | null;
      try { payload = await this.queue.begin(this.chatId, item.request); }
      catch { throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE"); }
      if (!payload) { await this.acknowledged(item.updateId); continue; }
      attempts += 1;
      let outcome: TelegramCommandOutcome = "sent";
      let providerMessageId: number | null = null;
      try { providerMessageId = Number(await this.sender.sendText(renderTelegramCommandReply(payload))); }
      catch (error) {
        outcome = error instanceof TelegramSendError && ["rejected", "throttled"].includes(error.outcome)
          ? "failed" : "delivery_unknown";
      }
      try { await this.queue.finish(this.chatId, item.updateId, outcome, providerMessageId); }
      catch { throw new Error("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE"); }
      await this.acknowledged(item.updateId);
      if (outcome === "sent") sent += 1;
    }
    return sent;
  }
}

export async function runTelegramCommandWorkerOnce(env: NotificationWorkerEnv): Promise<number> {
  const commandConfig = validatedTelegramConfig(env, env.telegram.commandMode, "TELEGRAM_COMMAND_CONFIG_INVALID");
  const certificationConfig = validatedTelegramCertificationConfig(env);
  const config = commandConfig ?? certificationConfig;
  if (!config) return 0;
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }) },
  });
  return new TelegramCommandWorker(
    new SupabaseTelegramCommandQueue(db), new TelegramCommandPoller(config.token),
    new TelegramHttpSender(config), config.chatId, Date.now,
    certificationConfig ? createTelegramCertificationCallbackWorker(env) : null,
  ).runOnce();
}
