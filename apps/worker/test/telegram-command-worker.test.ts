import { describe, expect, it, vi } from "vitest";
import {
  SupabaseTelegramCommandQueue,
  TelegramCommandPoller,
  TelegramCommandWorker,
  classifyTelegramUpdate,
  renderTelegramCommandReply,
  type TelegramCommandQueue,
} from "../src/telegram-command-worker.js";
import { TelegramSendError, type TelegramAlertSender } from "../src/telegram-alert-worker.js";

const chatId = "-1001234567890";
const entity = (length: number) => [{ type: "bot_command", offset: 0, length }];
const update = (updateId: number, text: string, overrides: Record<string, unknown> = {}) => ({
  update_id: updateId,
  message: { message_id: updateId, date: 1789092000, text, entities: entity(text.length), chat: { id: Number(chatId) }, from: { id: 7, is_bot: false }, ...overrides },
});

describe("classifyTelegramUpdate", () => {
  it.each([
    ["/users", "users"], ["/today", "today"], ["/lives", "lives"], ["/help", "help"], ["/start", "help"],
    ["/users@SallyLabSurveyAlertBot", "users"],
  ])("accepts exact whitelisted command %s", (text, command) => {
    expect(classifyTelegramUpdate(update(1, text), chatId)).toMatchObject({ updateId: 1, request: { command } });
  });

  it.each([
    update(1, "/unknown"), update(2, "/users extra"), update(3, "/users@OtherBot"),
    update(4, "/users", { from: { id: 7, is_bot: true } }),
    update(5, "/users", { chat: { id: -999 } }),
    { update_id: 6, edited_message: update(6, "/users").message },
    update(7, "/users", { entities: [{ type: "bold", offset: 0, length: 6 }] }),
    update(8, "x/users", { entities: [{ type: "bot_command", offset: 1, length: 6 }] }),
  ])("ignores unsupported Telegram updates while retaining their cursor", (value) => {
    expect(classifyTelegramUpdate(value, chatId)).toEqual({ updateId: value.update_id, request: null });
  });
});

describe("renderTelegramCommandReply", () => {
  it("renders concise Korean count summaries without identity data", () => {
    expect(renderTelegramCommandReply({ command: "users", generated_at: "2026-09-11T10:00:00Z", total_users: 20, active_users: 17, disabled_users: 3, passport_users: 8, passport_count: 10 })).toBe([
      "👥 회원 현황", "전체 20명 · 이용 가능한 회원 17명 · 이용 중지 회원 3명", "팬 패스 보유 회원 8명 · 발급 10개",
    ].join("\n"));
    expect(renderTelegramCommandReply({ command: "today", generated_at: "2026-09-11T10:00:00Z", date: "2026-09-11", signups: 2, fan_joins: 3, reservations: 4, attendances: 1 })).toContain("가입 2명 · 팬 가입 3건 · 예약 4건 · 출석 1건");
  });

  it("renders at most five bounded live labels in Asia/Seoul and stays below 4000 UTF-16 units", () => {
    const reply = renderTelegramCommandReply({ command: "lives", generated_at: "2026-09-11T10:00:00Z", total_lives: 5, lives: Array.from({ length: 5 }, () => ({ creator_name: `크리에이터\n${"가".repeat(100)}`, title: `라이브\u202e${"나".repeat(200)}`, starts_at: "2026-09-11T10:00:00Z", reservations: 12, attendances: 7 })) });
    expect(reply).toContain("2026. 09. 11. 19:00");
    expect(reply).toContain("공개 라이브 현황 · 총 5개");
    expect(reply).toContain("예약 12건 · 출석 7명");
    expect(reply.length).toBeLessThanOrEqual(4000);
    expect(reply).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    expect(reply).not.toContain("email");
  });
});

function queue(): TelegramCommandQueue & Record<"read" | "begin" | "finish" | "acknowledge", ReturnType<typeof vi.fn>> {
  return {
    read: vi.fn().mockResolvedValue({ lastUpdateId: 10, activatedAt: "2026-09-11T09:00:00Z" }),
    begin: vi.fn().mockResolvedValue({ command: "help", generated_at: "2026-09-11T10:00:00Z" }),
    finish: vi.fn().mockResolvedValue(undefined), acknowledge: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TelegramCommandWorker", () => {
  it("does nothing when command state is disabled or polling returns no updates", async () => {
    const q = queue(); q.read.mockResolvedValueOnce(null);
    const poller = { getUpdates: vi.fn() };
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    await expect(new TelegramCommandWorker(q, poller, sender, chatId).runOnce()).resolves.toBe(0);
    expect(poller.getUpdates).not.toHaveBeenCalled(); expect(sender.sendText).not.toHaveBeenCalled();
    q.read.mockResolvedValueOnce({ lastUpdateId: 10, activatedAt: "2026-09-11T09:00:00Z" }); poller.getUpdates.mockResolvedValueOnce([]);
    await expect(new TelegramCommandWorker(q, poller, sender, chatId).runOnce()).resolves.toBe(0);
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it("sorts updates, acknowledges ignored and deduped entries, and replies at most three times", async () => {
    const q = queue();
    q.begin.mockResolvedValue({ command: "help", generated_at: "2026-09-11T10:00:00Z" });
    const poller = { getUpdates: vi.fn().mockResolvedValue([update(15, "/help"), update(12, "/unknown"), update(11, "/help"), update(14, "/help"), update(13, "/help")]) };
    const sender: TelegramAlertSender = { sendText: vi.fn().mockResolvedValue(99n) };
    await expect(new TelegramCommandWorker(q, poller, sender, chatId).runOnce()).resolves.toBe(3);
    expect(q.begin.mock.calls.map((call) => call[1].updateId)).toEqual([11, 13, 14]);
    expect(q.acknowledge.mock.calls.map((call) => call[1])).toEqual([11, 12, 13, 14]);
    expect(sender.sendText).toHaveBeenCalledTimes(3);
  });

  it("records deterministic rejection as failed and network uncertainty without retrying", async () => {
    const q = queue();
    const poller = { getUpdates: vi.fn().mockResolvedValue([update(11, "/users"), update(12, "/today")]) };
    const sender: TelegramAlertSender = { sendText: vi.fn().mockRejectedValueOnce(new TelegramSendError("rejected")).mockRejectedValueOnce(new TelegramSendError("unknown")) };
    await expect(new TelegramCommandWorker(q, poller, sender, chatId).runOnce()).resolves.toBe(0);
    expect(q.finish.mock.calls.map((call) => call.slice(2, 4))).toEqual([["failed", null], ["delivery_unknown", null]]);
    expect(sender.sendText).toHaveBeenCalledTimes(2);
  });

  it("limits send attempts to three even when every delivery fails", async () => {
    const q = queue();
    const poller = { getUpdates: vi.fn().mockResolvedValue(Array.from({ length: 5 }, (_, index) => update(11 + index, "/help"))) };
    const sender: TelegramAlertSender = { sendText: vi.fn().mockRejectedValue(new TelegramSendError("rejected")) };
    await expect(new TelegramCommandWorker(q, poller, sender, chatId).runOnce()).resolves.toBe(0);
    expect(sender.sendText).toHaveBeenCalledTimes(3);
    expect(q.acknowledge.mock.calls.map((call) => call[1])).toEqual([11, 12, 13]);
  });

  it("does not resend after a successful delivery whose cursor acknowledgement failed", async () => {
    const q = queue(); const poller = { getUpdates: vi.fn().mockResolvedValue([update(11, "/help")]) };
    const sender: TelegramAlertSender = { sendText: vi.fn().mockResolvedValue(99n) };
    q.acknowledge.mockRejectedValueOnce(new Error("db detail"));
    const worker = new TelegramCommandWorker(q, poller, sender, chatId);
    await expect(worker.runOnce()).rejects.toThrow("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE");
    q.begin.mockResolvedValueOnce(null);
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it("does not begin or advance a command without the required 18-second reply budget", async () => {
    const q = queue(); const poller = { getUpdates: vi.fn().mockResolvedValue([update(11, "/help")]) };
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(23_000);
    await expect(new TelegramCommandWorker(q, poller, sender, chatId, now).runOnce()).resolves.toBe(0);
    expect(q.begin).not.toHaveBeenCalled(); expect(q.acknowledge).not.toHaveBeenCalled(); expect(sender.sendText).not.toHaveBeenCalled();
  });

  it("fails safely without advancing past a malformed provider update", async () => {
    const q = queue(); const poller = { getUpdates: vi.fn().mockResolvedValue([{ message: {} }, update(12, "/help")]) };
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    await expect(new TelegramCommandWorker(q, poller, sender, chatId).runOnce()).rejects.toThrow("TELEGRAM_COMMAND_POLL_UNAVAILABLE");
    expect(q.begin).not.toHaveBeenCalled(); expect(q.acknowledge).not.toHaveBeenCalled();
  });
});

describe("Telegram command adapters", () => {
  it("polls getUpdates with the fixed safe request contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }));
    const poller = new TelegramCommandPoller("123:token", fetcher);
    await expect(poller.getUpdates(41)).resolves.toEqual([]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123:token/getUpdates");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(String(init.body))).toEqual({ timeout: 1, limit: 10, offset: 41 });
  });

  it("uses the exact read, begin, finish, and cursor RPC contracts", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { last_update_id: 10, activated_at: "2026-09-11T09:00:00Z" }, error: null })
      .mockResolvedValueOnce({ data: { command: "help", generated_at: "2026-09-11T10:00:00Z" }, error: null })
      .mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: true, error: null });
    const q = new SupabaseTelegramCommandQueue({ rpc });
    await q.read(chatId); await q.begin(chatId, { updateId: 11, command: "help", messageDate: 1789092000 });
    await q.finish(chatId, 11, "sent", 99); await q.acknowledge(chatId, 11);
    expect(rpc.mock.calls).toEqual([
      ["read_telegram_command_state", { p_chat_id: chatId }],
      ["begin_telegram_command_reply", { p_chat_id: chatId, p_update_id: 11, p_command: "help", p_message_date: 1789092000 }],
      ["finish_telegram_command_reply", { p_chat_id: chatId, p_update_id: 11, p_outcome: "sent", p_provider_message_id: 99 }],
      ["acknowledge_telegram_command_updates", { p_chat_id: chatId, p_update_id: 11 }],
    ]);
  });

  it("rejects a DB reply payload for a different command", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { command: "today", generated_at: "2026-09-11T10:00:00Z", date: "2026-09-11", signups: 0, fan_joins: 0, reservations: 0, attendances: 0 }, error: null });
    await expect(new SupabaseTelegramCommandQueue({ rpc }).begin(chatId, { updateId: 11, command: "users", messageDate: 1789092000 }))
      .rejects.toThrow("TELEGRAM_COMMAND_QUEUE_UNAVAILABLE");
  });
});
