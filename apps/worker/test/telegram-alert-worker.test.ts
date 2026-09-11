import { describe, expect, it, vi } from "vitest";
import {
  TelegramAlertWorker,
  TelegramSendError,
  SupabaseTelegramAlertQueue,
  runTelegramAlertWorkerOnce,
  renderTelegramAlertMessage,
  type TelegramAlertBatch,
  type TelegramAlertQueue,
  type TelegramAlertSender,
} from "../src/telegram-alert-worker.js";
import { parseNotificationEnv } from "../src/notification-env.js";

const alerts: TelegramAlertBatch["alerts"] = [
  { kind: "member_joined", creator_name: null, live_title: null, actor_name: "제이", actor_email: "jay@example.com", winner_count: null, occurred_at: "2026-09-11T10:00:00.000Z" },
  { kind: "fan_joined", creator_name: "이퓨", live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-09-11T10:01:00.000Z" },
  { kind: "live_reserved", creator_name: "엘리나", live_title: "서울 팬미팅", actor_name: "민지", actor_email: "minji.long+fan@example.com", winner_count: null, occurred_at: "2026-09-11T10:02:00.000Z" },
  { kind: "live_attended", creator_name: "엘리나", live_title: "서울 팬미팅", actor_name: "솔", actor_email: "sol@example.com", winner_count: null, occurred_at: "2026-09-11T10:03:00.000Z" },
  { kind: "draw_published", creator_name: "엘리나", live_title: "서울 팬미팅", actor_name: "노출 금지", actor_email: "draw@example.com", winner_count: 5, occurred_at: "2026-09-11T10:04:00.000Z" },
];

describe("renderTelegramAlertMessage", () => {
  it("shows each actor and full email while keeping draw results identity-free", () => {
    expect(renderTelegramAlertMessage(alerts)).toBe([
      "🎉 ByUs 주요 소식",
      "",
      "• 신규 회원 가입",
      "  제이",
      "  jay@example.com",
      "• 이퓨 팬 가입",
      "  닉네임 미설정",
      "  이메일 미등록",
      "• 엘리나 · 서울 팬미팅 예약",
      "  민지",
      "  minji.long+fan@example.com",
      "• 엘리나 · 서울 팬미팅 출석",
      "  솔",
      "  sol@example.com",
      "• 엘리나 · 서울 팬미팅 추첨 결과 공개 · 당첨 5명",
      "",
      "관리자에서 확인하기",
      "https://byus.kr/admin",
    ].join("\n"));
    expect(renderTelegramAlertMessage(alerts)).not.toContain("draw@example.com");
  });

  it("does not merge distinct actors in the same event context", () => {
    const sameContext = [
      { ...alerts[1]!, actor_name: "하나", actor_email: "hana@example.com" },
      { ...alerts[1]!, actor_name: "둘", actor_email: "dul@example.com" },
    ];
    const message = renderTelegramAlertMessage(sameContext);
    expect(message).toContain("하나\n  hana@example.com");
    expect(message).toContain("둘\n  dul@example.com");
    expect(message.match(/• 이퓨 팬 가입/gu)).toHaveLength(2);
  });

  it("limits a batch to 5 and sanitizes the longest identity messages within 4000 UTF-16 units", () => {
    const malicious = Array.from({ length: 5 }, (_, index) => ({
      kind: "live_reserved" as const,
      creator_name: `크리에이터\n${"가".repeat(100)}${index}`,
      live_title: `라이브\u202e${"나".repeat(160)}`,
      actor_name: `닉네임\n${"다".repeat(100)}${index}`,
      actor_email: `person${index}\u202e${"e".repeat(400)}@example.com`,
      winner_count: null,
      occurred_at: "2026-09-11T10:00:00.000Z",
      user_id: "private-user-id",
      wallet_address: "0xprivate",
      answer: "private-answer",
    }));
    const message = renderTelegramAlertMessage(malicious);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    expect(message).not.toContain("크리에이터\n");
    expect(message).not.toContain("닉네임\n");
    expect(message).not.toContain("private-");
    expect(message).not.toContain("0xprivate");
    expect(message).toContain("https://byus.kr/admin");
    expect(() => renderTelegramAlertMessage([...malicious, malicious[0]!])).toThrow("TELEGRAM_ALERT_INVALID_BATCH");
  });
});

function queue(batch: TelegramAlertBatch | null): TelegramAlertQueue & {
  claim: ReturnType<typeof vi.fn>;
  begin: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(batch),
    begin: vi.fn().mockResolvedValue(true),
    finish: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TelegramAlertWorker", () => {
  const batch: TelegramAlertBatch = { batchId: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b", alerts: alerts.slice(0, 2) };

  it("claims, begins, sends, and acknowledges a batch exactly once", async () => {
    const q = queue(batch);
    const sender: TelegramAlertSender = { sendText: vi.fn().mockResolvedValue(42n) };
    await expect(new TelegramAlertWorker(q, sender, "-1001234567890").runOnce()).resolves.toBe(2);
    expect(q.claim).toHaveBeenCalledExactlyOnceWith("-1001234567890");
    expect(q.begin).toHaveBeenCalledExactlyOnceWith(batch.batchId, "-1001234567890");
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(q.finish).toHaveBeenCalledExactlyOnceWith(batch.batchId, "sent", 42n, null);
  });

  it("does not send or acknowledge when the begin CAS loses", async () => {
    const q = queue(batch);
    q.begin.mockResolvedValue(false);
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    await expect(new TelegramAlertWorker(q, sender, "-1001234567890").runOnce()).resolves.toBe(0);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(q.finish).not.toHaveBeenCalled();
  });

  it("does not send when the queue has no events", async () => {
    const q = queue(null);
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    await expect(new TelegramAlertWorker(q, sender, "-1001234567890").runOnce()).resolves.toBe(0);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(q.begin).not.toHaveBeenCalled();
    expect(q.finish).not.toHaveBeenCalled();
  });

  it("records an unknown send and never resends it", async () => {
    const q = queue(batch);
    const sender: TelegramAlertSender = { sendText: vi.fn().mockRejectedValue(new Error("provider detail")) };
    const worker = new TelegramAlertWorker(q, sender, "-1001234567890");
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(q.finish).toHaveBeenCalledExactlyOnceWith(batch.batchId, "unknown", null, null);
  });

  it("records throttling with bounded retry metadata", async () => {
    const q = queue(batch);
    const sender: TelegramAlertSender = { sendText: vi.fn().mockRejectedValue(new TelegramSendError("throttled", 86400)) };
    await expect(new TelegramAlertWorker(q, sender, "-1001234567890").runOnce()).resolves.toBe(0);
    expect(q.finish).toHaveBeenCalledExactlyOnceWith(batch.batchId, "throttled", null, 86400);
  });

  it("does not send again when the sent acknowledgement fails", async () => {
    const q = queue(batch);
    q.finish.mockRejectedValue(new Error("database unavailable"));
    const sender: TelegramAlertSender = { sendText: vi.fn().mockResolvedValue(42n) };
    await expect(new TelegramAlertWorker(q, sender, "-1001234567890").runOnce()).rejects.toThrow("database unavailable");
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });
});

describe("Telegram alert runtime configuration", () => {
  const source = {
    NOTIFICATION_WORKER_ID: "telegram-test",
    SUPABASE_URL: "https://gmrykvmtmuaeswpajteq.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48),
    WEB_PUSH_VAPID_SUBJECT: "mailto:ops@byus.kr",
    WEB_PUSH_VAPID_PUBLIC_KEY: "a".repeat(88),
    WEB_PUSH_VAPID_PRIVATE_KEY: "b".repeat(43),
    NOTIFICATION_EXTERNAL_ENVIRONMENT: "prod",
  };

  it("is completely dormant when Telegram mode is absent or disabled", async () => {
    await expect(runTelegramAlertWorkerOnce(parseNotificationEnv(source))).resolves.toBe(0);
    await expect(runTelegramAlertWorkerOnce(parseNotificationEnv({
      ...source,
      TELEGRAM_ALERT_MODE: "disabled",
      TELEGRAM_BOT_TOKEN: "invalid",
      TELEGRAM_CHAT_ID: "invalid",
    }))).resolves.toBe(0);
  });

  it.each([
    [{ TELEGRAM_ALERT_MODE: "invalid" }, "invalid mode"],
    [{ TELEGRAM_ALERT_MODE: "enabled", TELEGRAM_BOT_TOKEN: "invalid", TELEGRAM_CHAT_ID: "-1001234567890" }, "invalid token"],
    [{ TELEGRAM_ALERT_MODE: "enabled", TELEGRAM_BOT_TOKEN: `123456789:${"A".repeat(35)}`, TELEGRAM_CHAT_ID: "1234567890" }, "non-group chat"],
    [{ TELEGRAM_ALERT_MODE: "enabled", TELEGRAM_BOT_TOKEN: `123456789:${"A".repeat(35)}`, TELEGRAM_CHAT_ID: "-1001234567890", NOTIFICATION_EXTERNAL_ENVIRONMENT: "dev" }, "non-production environment"],
    [{ TELEGRAM_ALERT_MODE: "enabled", TELEGRAM_BOT_TOKEN: `123456789:${"A".repeat(35)}`, TELEGRAM_CHAT_ID: "-1001234567890", SUPABASE_URL: "https://other.supabase.co" }, "non-production database"],
  ])("rejects %s only when the Telegram branch runs", async (overrides, _label) => {
    const env = parseNotificationEnv({ ...source, ...overrides });
    await expect(runTelegramAlertWorkerOnce(env)).rejects.toThrow("TELEGRAM_ALERT_CONFIG_INVALID");
  });
});

describe("SupabaseTelegramAlertQueue", () => {
  it("uses the exact claim, begin, and finish RPC contracts", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { batch_id: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b", alerts: alerts.slice(0, 1) }, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const q = new SupabaseTelegramAlertQueue({ rpc });
    const claimed = await q.claim("-1001234567890");
    expect(claimed?.alerts).toHaveLength(1);
    await expect(q.begin(claimed!.batchId, "-1001234567890")).resolves.toBe(true);
    await q.finish(claimed!.batchId, "sent", 321n, null);
    expect(rpc.mock.calls).toEqual([
      ["claim_telegram_alert_batch_with_identity", { p_chat_id: "-1001234567890" }],
      ["begin_telegram_alert_send", { p_batch_id: claimed!.batchId, p_chat_id: "-1001234567890" }],
      ["finish_telegram_alert_batch", { p_batch_id: claimed!.batchId, p_outcome: "sent", p_provider_message_id: 321, p_retry_after: null }],
    ]);
  });

  it("rejects unexpected private fields from a claimed snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        batch_id: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b",
        alerts: [{ ...alerts[0], user_id: "private-user-id" }],
      },
      error: null,
    });
    await expect(new SupabaseTelegramAlertQueue({ rpc }).claim("-1001234567890"))
      .rejects.toThrow("TELEGRAM_ALERT_INVALID_BATCH");
  });

  it("sanitizes rejected RPC errors", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("database host and secret details"));
    const error = await new SupabaseTelegramAlertQueue({ rpc }).claim("-1001234567890").catch((value: unknown) => value);
    expect(String(error)).toBe("Error: TELEGRAM_ALERT_QUEUE_UNAVAILABLE");
  });
});
