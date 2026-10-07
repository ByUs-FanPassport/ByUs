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
const inquiryId = "8f34398c-0c7a-4de0-8ca8-4c6aa2c2de19";
const csAlerts: TelegramAlertBatch["alerts"] = [
  { kind: "cs_inquiry_created", creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-09-11T10:05:00.000Z", inquiry_id: inquiryId, message_body: "문의 내용을 확인해 주세요." },
  { kind: "cs_user_replied", creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-09-11T10:06:00.000Z", inquiry_id: inquiryId, message_body: "문의 내용을 확인해 주세요." },
];
const actorId = "8f34398c-0c7a-4de0-8ca8-4c6aa2c2de19";
const recipientId = "559fe228-ff92-4a85-a3e9-ad83d9e60f8b";
type DetailedKind = "fan_post_created" | "fan_post_commented" | "fan_post_liked" | "fan_lounge_posted" | "notice_commented" | "daily_checked_in" | "certification_approved";
function detailedActivity(kind: DetailedKind, overrides: Record<string, unknown> = {}): TelegramAlertBatch["alerts"][number] {
  return {
    kind,
    creator_name: null,
    live_title: null,
    actor_name: "활동자",
    actor_email: "actor@example.com",
    winner_count: null,
    occurred_at: "2026-09-11T10:02:03.000Z",
    activity_context: null,
    activity_quantity: null,
    detail: {
      actor_id: actorId,
      recipient_id: recipientId,
      recipient_name: "받는 사람",
      creator_name: "크리에이터",
      context: "게시글 제목",
      body: "첫 줄\n둘째 줄",
      path: "/c/creator/community/01234567-1234-4234-8234-012345678901#comment-8f34398c-0c7a-4de0-8ca8-4c6aa2c2de19",
      result: "좋아요 3개",
      is_reply: false,
    },
    ...overrides,
  } as TelegramAlertBatch["alerts"][number];
}

describe("renderTelegramAlertMessage", () => {
  it("keeps legacy count-only RSVP alerts compatible in a mixed batch", () => {
    const rsvp = { kind: "byus_day_rsvp_received" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-10-02T00:00:00Z", activity_context: "누적 3명", activity_quantity: 3 };
    const message = renderTelegramAlertMessage([alerts[0]!, rsvp]);
    expect(message).toContain("• 신규 회원 가입");
    expect(message).toContain("• ByUs Day RSVP 접수\n  누적 3명\nhttps://byus.kr/admin/byus-day-rsvps");
    expect(message).not.toMatch(/김별|010-|byeol@example/u);
  });
  it("shows each RSVP guest's Korean and English names alongside the cumulative count", async () => {
    const rsvp = { kind: "byus_day_rsvp_received" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-10-02T00:00:00Z", activity_context: "김별 · Byeol Kim", activity_quantity: 3 };
    const rpc = vi.fn().mockResolvedValue({ data: { batch_id: "8f34398c-0c7a-4de0-8ca8-4c6aa2c2de19", alerts: [rsvp] }, error: null });
    const claimed = await new SupabaseTelegramAlertQueue({ rpc }).claim("-1001234567890");
    const message = renderTelegramAlertMessage([alerts[0]!, ...claimed!.alerts]);
    expect(message).toContain("• ByUs Day RSVP 접수\n  접수자: 김별 · Byeol Kim\n  누적 3명");
    expect(message).not.toMatch(/010-|byeol@example|900101/u);
  });
  it("preserves maximum-length RSVP names and removes line and direction controls", () => {
    const names = `${"가".repeat(80)} · ${"X".repeat(80)}`;
    const rsvp = { kind: "byus_day_rsvp_received" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-10-02T00:00:00Z", activity_context: names + "\u202e\n", activity_quantity: 3 };
    const message = renderTelegramAlertMessage([rsvp]);
    expect(message).toContain(`  접수자: ${names}\n  누적 3명`);
    expect(message).not.toContain("\u202e");
    expect(renderTelegramAlertMessage(Array.from({ length: 5 }, () => rsvp)).length).toBeLessThanOrEqual(4000);
  });
  it("claims and renders RSVP affiliation and job title below the guest names", async () => {
    const rsvp = { kind: "byus_day_rsvp_received" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-10-04T00:00:00Z", activity_context: "김별 · Byeol Kim", activity_quantity: 3, rsvp: { affiliation: "ByUs", occupation: "프로듀서" } };
    const rpc = vi.fn().mockResolvedValue({ data: { batch_id: "8f34398c-0c7a-4de0-8ca8-4c6aa2c2de19", alerts: [rsvp] }, error: null });
    const queue = new SupabaseTelegramAlertQueue({ rpc });
    const claimed = await queue.claim("-1001234567890");
    for (const companion of [alerts[0]!, detailedActivity("fan_post_created")]) {
      const message = renderTelegramAlertMessage([companion, ...claimed!.alerts]);
      expect(message).toContain("• ByUs Day RSVP 접수\n  접수자: 김별 · Byeol Kim\n  소속: ByUs\n  직책: 프로듀서\n  누적 3명\nhttps://byus.kr/admin/byus-day-rsvps");
    }
    for (const invalid of [
      { ...rsvp, rsvp: { ...rsvp.rsvp, email: "private@example.com" } },
      { ...rsvp, rsvp: { affiliation: "ByUs" } },
      { ...rsvp, rsvp: { ...rsvp.rsvp, affiliation: "X".repeat(241) } },
      { ...rsvp, kind: "business_received" },
    ]) {
      rpc.mockResolvedValueOnce({ data: { batch_id: claimed!.batchId, alerts: [invalid] }, error: null });
      await expect(queue.claim("-1001234567890")).rejects.toThrow("TELEGRAM_ALERT_INVALID_BATCH");
    }
  });
  it("sanitizes RSVP details and bounds five maximum-length messages", () => {
    const rsvp = { kind: "byus_day_rsvp_received" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-10-04T00:00:00Z", activity_context: `${"가".repeat(80)} · ${"X".repeat(80)}`, activity_quantity: 3, rsvp: { affiliation: "소속\n\u202e회사", occupation: "직책\u2028\u2066대표" } };
    const message = renderTelegramAlertMessage([rsvp]);
    expect(message).toContain("  소속: 소속 회사\n  직책: 직책 대표");
    expect(message).not.toMatch(/[\u202e\u2028\u2066]/u);
    for (const value of ["가".repeat(120), "😀".repeat(120)]) {
      const longMessage = renderTelegramAlertMessage(Array.from({ length: 5 }, () => ({ ...rsvp, rsvp: { affiliation: value, occupation: value } })));
      expect(longMessage.length).toBeLessThanOrEqual(4000);
      expect(longMessage.match(/  소속: /gu)).toHaveLength(5);
      expect(longMessage.match(/  직책: /gu)).toHaveLength(5);
      expect(longMessage).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
      if (value.length === 120) expect(longMessage).toContain(`  소속: ${value}\n  직책: ${value}`);
    }
  });
  it("renders campaign visits without identities and validates the claim context", async () => {
    const campaign = { kind: "campaign_visited" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-09-21T00:00:00Z", campaign_name: "Mirrorworld · 뱅크시 이벤트", campaign_channel: "mirrorworld" };
    const rpc = vi.fn().mockResolvedValue({ data: { batch_id: "8f34398c-0c7a-4de0-8ca8-4c6aa2c2de19", alerts: [campaign] }, error: null });
    const queue = new SupabaseTelegramAlertQueue({ rpc });
    const claimed = await queue.claim("-1001234567890");
    const message = renderTelegramAlertMessage(claimed!.alerts);
    expect(message).toContain("• 캠페인 링크로 새 방문\n  Mirrorworld · 뱅크시 이벤트\n  채널: mirrorworld · 브라우저 세션 1건\nhttps://byus.kr/admin/campaigns");
    expect(message).not.toMatch(/닉네임|이메일/);
    for (const invalid of [{ ...campaign, campaign_name: undefined }, { ...campaign, actor_email: "private@example.com" }]) {
      rpc.mockResolvedValueOnce({ data: { batch_id: claimed!.batchId, alerts: [invalid] }, error: null });
      await expect(queue.claim("-1001234567890")).rejects.toThrow("TELEGRAM_ALERT_INVALID_BATCH");
    }
  });
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

  it("renders CS creation and follow-up with the approved message body and validated inquiry URL", () => {
    const message = renderTelegramAlertMessage(csAlerts.map((alert) => ({
      ...alert,
      subject: "Private subject",
      body: "Private inquiry body",
      requester_name: "Private requester",
      requester_email: "name@example.com",
    })));
    expect(message).toBe([
      "🎉 ByUs 주요 소식",
      "",
      "• 새 CS 문의 접수",
      "내용: 문의 내용을 확인해 주세요.",
      `https://byus.kr/admin/inquiries/${inquiryId}`,
      "• CS 문의에 새 메시지",
      "내용: 문의 내용을 확인해 주세요.",
      `https://byus.kr/admin/inquiries/${inquiryId}`,
      "",
      "관리자에서 확인하기",
      "https://byus.kr/admin",
    ].join("\n"));
    expect(message).not.toMatch(/Private|name@example\.com/u);
  });

  it("bounds five long CS bodies including astral characters and control characters", () => {
    const message = renderTelegramAlertMessage(Array.from({ length: 5 }, () => ({
      ...csAlerts[0]!, message_body: "확인\n\u202e" + "😀".repeat(3995),
    })));
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message.match(/…/gu)).toHaveLength(5);
    expect(message).not.toContain("\u202e");
    expect(message).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
    expect(message.match(new RegExp(inquiryId, "g"))).toHaveLength(5);
  });

  it("preserves existing event rendering in a mixed CS batch", () => {
    const message = renderTelegramAlertMessage([alerts[0]!, csAlerts[0]!, alerts[4]!]);
    expect(message).toContain("• 신규 회원 가입\n  제이\n  jay@example.com");
    expect(message).toContain(`• 새 CS 문의 접수\n내용: 문의 내용을 확인해 주세요.\nhttps://byus.kr/admin/inquiries/${inquiryId}`);
    expect(message).toContain("• 엘리나 · 서울 팬미팅 추첨 결과 공개 · 당첨 5명");
    expect(message).not.toContain("draw@example.com");
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

  it.each([
    ["fan_post_created", false, "팬 게시글 작성"],
    ["fan_post_commented", true, "팬 게시글 답글 작성"],
    ["fan_post_liked", false, "팬 게시글 좋아요"],
    ["fan_lounge_posted", false, "응원글 작성"],
    ["fan_lounge_posted", true, "응원글 답글 작성"],
    ["notice_commented", false, "공지 댓글 작성"],
    ["daily_checked_in", false, "일일 출석 체크"],
  ] as const)("renders %s with its Korean label", (kind, isReply, label) => {
    const alert = detailedActivity(kind);
    alert.detail!.is_reply = isReply;
    expect(renderTelegramAlertMessage([alert])).toContain(`• ${label}`);
  });

  it("renders who-to-whom details, full email, multiline Unicode body, KST time, and canonical link", () => {
    const email = `${"e".repeat(308)}@example.com`;
    const body = `${"😀\n".repeat(499)}끝끝`;
    const alert = detailedActivity("fan_post_commented", { actor_email: email });
    Object.assign(alert.detail!, {
      recipient_name: "😀".repeat(48),
      creator_name: "😀".repeat(120),
      context: "😀".repeat(160),
      body,
      path: `/${"p".repeat(499)}`,
      result: "😀".repeat(160),
    });
    const message = renderTelegramAlertMessage([alert]);
    expect(message).toContain(`활동자: 활동자 · ${email}`);
    expect(message).toContain(`활동자 ID: ${actorId}`);
    expect(message).toContain(`대상 ID: ${recipientId}`);
    expect(message).toContain(`내용:\n${body.split("\n").map((line) => `│${line}`).join("\n")}`);
    expect(message).toContain("시각: 2026-09-11 19:02:03 KST");
    expect(message).toContain(`https://byus.kr${alert.detail!.path}`);
    expect(message).not.toContain("본문 일부 생략");
    expect(message.length).toBeLessThanOrEqual(4000);
  });

  it("truncates a 5000-codepoint post preview within the actual Telegram limit", () => {
    const alert = detailedActivity("fan_post_created");
    alert.detail!.body = "😀".repeat(5000);
    const message = renderTelegramAlertMessage([alert]);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).toContain("… (본문 일부 생략)");
    expect(message).toContain(`https://byus.kr${alert.detail!.path}`);
    expect(message).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
  });

  it("renders a Telegram certification reviewer without inventing an app identity", () => {
    const alert = detailedActivity("certification_approved", { actor_name: "ByUs 운영자", actor_email: null });
    Object.assign(alert.detail!, {
      actor_id: null,
      telegram_actor_id: "12345678901234567890",
      telegram_username: "byus_ops",
      context: "팬 인증 신청",
      result: "팬 인증 승인",
    });
    const message = renderTelegramAlertMessage([alert]);
    expect(message).toContain("활동자: ByUs 운영자 · @byus_ops");
    expect(message).toContain("Telegram ID: 12345678901234567890");
    expect(message).toContain("대상 내용: 팬 인증 신청");
    expect(message).toContain(`대상 ID: ${recipientId}`);
    expect(message).not.toMatch(/이메일 미등록|활동자 ID:/u);
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

  it("renders before begin and never begins or sends an invalid detailed batch", async () => {
    const invalid = detailedActivity("fan_post_created");
    invalid.detail!.path = "//evil.example/spoof";
    const q = queue({ batchId: batch.batchId, alerts: [invalid] });
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    await expect(new TelegramAlertWorker(q, sender, "-1001234567890").runOnce())
      .rejects.toThrow("TELEGRAM_ALERT_INVALID_BATCH");
    expect(q.begin).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(q.finish).not.toHaveBeenCalled();
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
      ["claim_telegram_alert_batch_with_cs_content", { p_chat_id: "-1001234567890" }],
      ["begin_telegram_alert_send", { p_batch_id: claimed!.batchId, p_chat_id: "-1001234567890" }],
      ["finish_telegram_alert_batch", { p_batch_id: claimed!.batchId, p_outcome: "sent", p_provider_message_id: 321, p_retry_after: null }],
    ]);
  });

  it.each([
    ["missing CS message body", { ...csAlerts[0], message_body: undefined }],
    ["message body on an existing kind", { ...alerts[0], message_body: "not allowed" }],
    ["missing CS inquiry id", { ...csAlerts[0], inquiry_id: undefined }],
    ["invalid CS inquiry id", { ...csAlerts[0], inquiry_id: "https://evil.example/admin/inquiries/private" }],
    ["inquiry id on an existing kind", { ...alerts[0], inquiry_id: inquiryId }],
    ["private content on a CS event", { ...csAlerts[0], actor_name: "Private Person", actor_email: "name@example.com", subject: "Private subject", body: "Private body" }],
  ])("rejects %s before sending", async (_label, alert) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { batch_id: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b", alerts: [alert] },
      error: null,
    });
    const sender: TelegramAlertSender = { sendText: vi.fn() };
    const worker = new TelegramAlertWorker(
      new SupabaseTelegramAlertQueue({ rpc }),
      sender,
      "-1001234567890",
    );
    await expect(worker.runOnce()).rejects.toThrow("TELEGRAM_ALERT_INVALID_BATCH");
    expect(sender.sendText).not.toHaveBeenCalled();
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

  it.each([
    ["extra detail key", (() => { const alert = detailedActivity("fan_post_created"); return { ...alert, detail: { ...alert.detail, extra: "private" } }; })()],
    ["missing detail key", (() => { const alert = detailedActivity("fan_post_created"); const { result: _, ...detail } = alert.detail!; return { ...alert, detail }; })()],
    ["external-looking path", (() => { const alert = detailedActivity("fan_post_created"); return { ...alert, detail: { ...alert.detail, path: "//evil.example/post" } }; })()],
    ["control character in path", (() => { const alert = detailedActivity("fan_post_created"); return { ...alert, detail: { ...alert.detail, path: "/c/safe\nhttps://evil.example" } }; })()],
  ])("rejects %s in strict detail payloads", async (_label, alert) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { batch_id: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b", alerts: [alert] },
      error: null,
    });
    await expect(new SupabaseTelegramAlertQueue({ rpc }).claim("-1001234567890"))
      .rejects.toThrow("TELEGRAM_ALERT_INVALID_BATCH");
  });

  it.each([
    ["missing reviewer identity", (() => { const alert = detailedActivity("certification_approved", { actor_name: "운영자", actor_email: null }); return { ...alert, detail: { ...alert.detail, actor_id: null } }; })()],
    ["both reviewer identities", (() => { const alert = detailedActivity("certification_approved"); return { ...alert, detail: { ...alert.detail, telegram_actor_id: "12345", telegram_username: null } }; })()],
    ["Telegram identity on another kind", (() => { const alert = detailedActivity("fan_post_created", { actor_email: null }); return { ...alert, detail: { ...alert.detail, actor_id: null, telegram_actor_id: "12345", telegram_username: null } }; })()],
  ])("rejects %s", async (_label, alert) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { batch_id: "559fe228-ff92-4a85-a3e9-ad83d9e60f8b", alerts: [alert] },
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

describe("major activity notifications", () => {
  const activity = { kind: "raffle_entered" as const, creator_name: null, live_title: null, actor_name: null, actor_email: null, winner_count: null, occurred_at: "2026-09-21T00:00:00Z", activity_context: "뱅크시\u202e\n전시", activity_quantity: 3 };
  it("renders bounded anonymous activities and rejects identity contamination", async () => {
    expect(renderTelegramAlertMessage([activity])).toContain("사용 응모권 3장");
    expect(renderTelegramAlertMessage([activity])).not.toContain("\u202e");
    expect(renderTelegramAlertMessage(Array.from({ length: 5 }, () => ({ ...activity, activity_context: "😀".repeat(160) })) ).length).toBeLessThanOrEqual(4000);
    expect(() => renderTelegramAlertMessage([{ ...activity, actor_email: "private@example.com" }])).toThrow();
    expect(() => renderTelegramAlertMessage([{ ...activity, message_body: "private proof" }])).toThrow();
    const q = new SupabaseTelegramAlertQueue({ rpc: vi.fn().mockResolvedValue({ error: null, data: { batch_id: "01234567-1234-4234-8234-012345678901", alerts: [activity] } }) });
    expect((await q.claim("-1001234567890"))?.alerts[0]?.kind).toBe("raffle_entered");
  });
});
