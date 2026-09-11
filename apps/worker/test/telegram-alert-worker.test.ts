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
  { kind: "member_joined", creator_name: null, live_title: null, winner_count: null, occurred_at: "2026-09-11T10:00:00.000Z" },
  { kind: "member_joined", creator_name: null, live_title: null, winner_count: null, occurred_at: "2026-09-11T10:01:00.000Z" },
  { kind: "fan_joined", creator_name: "이퓨", live_title: null, winner_count: null, occurred_at: "2026-09-11T10:02:00.000Z" },
  { kind: "fan_joined", creator_name: "이퓨", live_title: null, winner_count: null, occurred_at: "2026-09-11T10:03:00.000Z" },
  { kind: "live_reserved", creator_name: "엘리나", live_title: "서울 팬미팅", winner_count: null, occurred_at: "2026-09-11T10:04:00.000Z" },
  { kind: "live_attended", creator_name: "엘리나", live_title: "서울 팬미팅", winner_count: null, occurred_at: "2026-09-11T10:05:00.000Z" },
  { kind: "draw_published", creator_name: "엘리나", live_title: "서울 팬미팅", winner_count: 2, occurred_at: "2026-09-11T10:06:00.000Z" },
  { kind: "draw_published", creator_name: "엘리나", live_title: "서울 팬미팅", winner_count: 3, occurred_at: "2026-09-11T10:07:00.000Z" },
];

describe("renderTelegramAlertMessage", () => {
  it("groups major events by kind and public names with accurate people counts", () => {
    expect(renderTelegramAlertMessage(alerts)).toBe([
      "🎉 ByUs 주요 소식",
      "",
      "• 신규 회원 2명 가입",
      "• 이퓨 팬 가입 2명",
      "• 엘리나 · 서울 팬미팅 예약 1건",
      "• 엘리나 · 서울 팬미팅 출석 1명",
      "• 엘리나 · 서울 팬미팅 추첨 결과 공개 · 당첨 5명",
      "",
      "관리자에서 확인하기",
      "https://byus.kr/admin",
    ].join("\n"));
  });

  it("limits a batch to 20 and removes controls without rendering unrelated PII", () => {
    const malicious = Array.from({ length: 20 }, (_, index) => ({
      kind: "live_reserved" as const,
      creator_name: `크리에이터\n${"가".repeat(100)}${index}`,
      live_title: `라이브\u202e${"나".repeat(160)}`,
      winner_count: null,
      occurred_at: "2026-09-11T10:00:00.000Z",
      user_id: "private-user-id",
      nickname: "private-nickname",
      email: "private@example.com",
      wallet_address: "0xprivate",
      answer: "private-answer",
    }));
    const message = renderTelegramAlertMessage(malicious);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    expect(message).not.toContain("크리에이터\n");
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
      ["claim_telegram_alert_batch", { p_chat_id: "-1001234567890" }],
      ["begin_telegram_alert_send", { p_batch_id: claimed!.batchId, p_chat_id: "-1001234567890" }],
      ["finish_telegram_alert_batch", { p_batch_id: claimed!.batchId, p_outcome: "sent", p_provider_message_id: 321, p_retry_after: null }],
    ]);
  });

  it("rejects unexpected private fields from a claimed snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        batch_id: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b",
        alerts: [{ ...alerts[0], email: "private@example.com" }],
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
