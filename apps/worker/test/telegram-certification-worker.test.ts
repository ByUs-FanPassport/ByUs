import { describe, expect, it, vi } from "vitest";
import {
  SupabaseTelegramCertificationQueue,
  SupabaseCertificationStorage,
  TelegramCertificationHttpClient,
  TelegramCertificationCallbackWorker,
  TelegramCertificationWorker,
  TelegramDeliveryError,
  renderTelegramCertificationCaption,
  runTelegramCertificationWorkerOnce,
  validatedTelegramCertificationConfig,
  type TelegramCertificationClaim,
  type TelegramCertificationQueue,
  type TelegramCertificationCallback,
} from "../src/telegram-certification-worker.js";
import { parseNotificationEnv } from "../src/notification-env.js";

const token = `123456789:${"A".repeat(35)}`;
const chatId = "-1001234567890";
const deliveryId = "a1000000-0000-4000-8000-000000000001";
const submissionId = "a2000000-0000-4000-8000-000000000001";
const firstUploadId = "a3000000-0000-4000-8000-000000000001";
const secondUploadId = "a3000000-0000-4000-8000-000000000002";
const callbackToken = "0123456789abcdef0123456789abcdef";

const claim: TelegramCertificationClaim = {
  deliveryId,
  submissionId,
  callbackToken,
  expectedReviewRevision: 3,
  creatorName: "엘리나",
  missionTitle: "팬미팅 인증",
  membershipPlatform: "Weverse",
  applicantNickname: "별빛 팬",
  attemptNumber: 2,
  submittedAt: "2026-09-15T01:23:45.000Z",
  note: "현장에 다녀왔어요.",
  reward: { scorePoints: 30, ticketAmount: 2, stampCount: 0 },
  uploads: [
    { id: firstUploadId, order: 1, objectPath: "proofs/first.webp", contentType: "image/webp", width: 1600, height: 1200 },
    { id: secondUploadId, order: 2, objectPath: "proofs/second.png", contentType: "image/png", width: 401, height: 20 },
  ],
};

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("renderTelegramCertificationCaption", () => {
  it("renders the review context but excludes email, full member UUID and unsafe controls", () => {
    const caption = renderTelegramCertificationCaption({
      ...claim,
      creatorName: "엘리나\n공식",
      missionTitle: "팬미팅\u202e인증",
      applicantNickname: "별빛\u2066팬",
      note: `확인 부탁드립니다. ${"가".repeat(1_500)}`,
      // A strict public shape must ignore neither of these private fields.
      email: "member@example.com",
      appUserId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    } as TelegramCertificationClaim);
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain("엘리나 공식 · 팬미팅 인증");
    expect(caption).toContain("플랫폼: Weverse");
    expect(caption).toContain("신청자: 별빛 팬");
    expect(caption).toContain("2번째 제출");
    expect(caption).toContain("보상: 활동 점수 30점 · 응모권 2장");
    expect(caption).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    expect(caption).not.toContain("member@example.com");
    expect(caption).not.toContain("ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(caption.endsWith("…")).toBe(true);
  });
});

describe("TelegramCertificationHttpClient", () => {
  it("sends the first eligible image as a protected photo with caption and safe buttons", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 321 } }));
    const client = new TelegramCertificationHttpClient({ token, chatId }, fetcher);
    await expect(client.sendProof({
      upload: claim.uploads[0]!, bytes: new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" }),
      caption: "인증 확인", callbackToken, adminUrl: `https://byus.kr/admin/certifications?status=pending&submission=${submissionId}`,
      replyToMessageId: null,
    })).resolves.toBe(321);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendPhoto`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const body = init.body as FormData;
    expect(body.get("chat_id")).toBe(chatId);
    expect(body.get("caption")).toBe("인증 확인");
    expect(body.get("protect_content")).toBe("true");
    expect(body.get("reply_to_message_id")).toBeNull();
    expect(JSON.parse(String(body.get("reply_markup")))).toEqual({ inline_keyboard: [[
      { text: "승인", callback_data: callbackToken },
      { text: "관리자에서 보기", url: `https://byus.kr/admin/certifications?status=pending&submission=${submissionId}` },
    ]] });
    expect(new TextEncoder().encode(callbackToken)).toHaveLength(32);
    expect(String(body.get("reply_markup"))).not.toContain("별빛 팬");
  });

  it("uses a protected document for invalid photo metadata and replies to the first message without repeated controls", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 322 } }));
    const client = new TelegramCertificationHttpClient({ token, chatId }, fetcher);
    await client.sendProof({
      upload: claim.uploads[1]!, bytes: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      caption: null, callbackToken: null, adminUrl: null, replyToMessageId: 321,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendDocument`);
    const body = init.body as FormData;
    expect(body.get("protect_content")).toBe("true");
    expect(body.get("reply_to_message_id")).toBe("321");
    expect(body.get("caption")).toBeNull();
    expect(body.get("reply_markup")).toBeNull();
    expect(body.get("document")).toBeInstanceOf(Blob);
  });

  it.each([
    [429, { ok: false, error_code: 429, parameters: { retry_after: 75 } }, "throttled", 75],
    [400, { ok: false }, "rejected", undefined],
    [404, { ok: false, error_code: 404 }, "rejected", undefined],
    [500, { ok: false }, "delivery_unknown", undefined],
    [200, { ok: true, result: {} }, "delivery_unknown", undefined],
  ])("classifies provider status %s without retrying", async (status, body, outcome, retryAfter) => {
    const fetcher = vi.fn().mockResolvedValue(response(status as number, body));
    const client = new TelegramCertificationHttpClient({ token, chatId }, fetcher);
    const error = await client.sendProof({
      upload: claim.uploads[0]!, bytes: new Blob(["proof"], { type: "image/webp" }), caption: "인증",
      callbackToken, adminUrl: `https://byus.kr/admin/certifications?status=pending&submission=${submissionId}`, replyToMessageId: null,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramDeliveryError);
    expect(error).toMatchObject({ outcome, retryAfter });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(error)).not.toContain(token);
  });
});

function queue(): TelegramCertificationQueue & Record<"claim" | "begin" | "record" | "health", ReturnType<typeof vi.fn>> {
  return { claim: vi.fn().mockResolvedValue(claim), begin: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined), health: vi.fn().mockResolvedValue({ pending: 0, claimed: 0, sending: 0, sent: 1, partial: 0, failed: 0, deliveryUnknown: 0, skipped: 0 }) };
}

describe("TelegramCertificationWorker", () => {
  it("downloads private objects and records the first provider id before sending reply attachments", async () => {
    const q = queue();
    const storage = { download: vi.fn().mockResolvedValue(new Blob(["proof"], { type: "image/jpeg" })) };
    const events: string[] = [];
    q.begin.mockImplementation(async () => { events.push("begin"); });
    q.record.mockImplementation(async (_deliveryId, _chatId, uploadId) => { events.push(`record:${uploadId}`); });
    const sender = { sendProof: vi.fn().mockImplementation(async ({ upload }: { upload: { id: string } }) => {
      events.push(`send:${upload.id}`); return upload.id === firstUploadId ? 321 : 322;
    }) };
    await expect(new TelegramCertificationWorker(q, storage, sender, chatId).runOnce()).resolves.toBe(1);
    expect(storage.download.mock.calls.map((call) => call[0])).toEqual(["proofs/first.webp", "proofs/second.png"]);
    expect(sender.sendProof.mock.calls[0]![0]).toMatchObject({ caption: expect.stringContaining("엘리나"), callbackToken, replyToMessageId: null });
    expect(sender.sendProof.mock.calls[1]![0]).toMatchObject({ caption: null, callbackToken: null, adminUrl: null, replyToMessageId: 321 });
    expect(events).toEqual(["begin", `send:${firstUploadId}`, `record:${firstUploadId}`, `send:${secondUploadId}`, `record:${secondUploadId}`]);
    expect(q.record.mock.calls.map((call) => call.slice(2))).toEqual([
      [firstUploadId, 1, "sent", 321, null], [secondUploadId, 2, "sent", 322, null],
    ]);
  });

  it.each([
    [new TelegramDeliveryError("throttled", 45), "throttled", 45],
    [new TelegramDeliveryError("rejected"), "rejected", null],
    [new TelegramDeliveryError("delivery_unknown"), "delivery_unknown", null],
    [new Error("network secret"), "delivery_unknown", null],
  ])("records a terminal or bounded retry outcome and never resends in the same run", async (failure, outcome, retryAfter) => {
    const q = queue();
    const sender = { sendProof: vi.fn().mockRejectedValue(failure) };
    const storage = { download: vi.fn().mockResolvedValue(new Blob(["proof"])) };
    await expect(new TelegramCertificationWorker(q, storage, sender, chatId).runOnce()).resolves.toBe(0);
    expect(sender.sendProof).toHaveBeenCalledTimes(1);
    expect(q.record).toHaveBeenCalledExactlyOnceWith(deliveryId, chatId, firstUploadId, 1, outcome, null, retryAfter);
  });

  it("records an ambiguous attachment after the persisted action message without retrying either image", async () => {
    const q = queue();
    const storage = { download: vi.fn().mockResolvedValue(new Blob(["proof"])) };
    const sender = { sendProof: vi.fn().mockResolvedValueOnce(321).mockRejectedValueOnce(new TelegramDeliveryError("delivery_unknown")) };
    await expect(new TelegramCertificationWorker(q, storage, sender, chatId).runOnce()).resolves.toBe(0);
    expect(sender.sendProof).toHaveBeenCalledTimes(2);
    expect(q.record.mock.calls.map((call) => call.slice(2))).toEqual([
      [firstUploadId, 1, "sent", 321, null],
      [secondUploadId, 2, "delivery_unknown", null, null],
    ]);
  });
});

describe("SupabaseCertificationStorage", () => {
  it("downloads only from the private certification proof bucket", async () => {
    const proof = new Blob(["private-proof"]);
    const download = vi.fn().mockResolvedValue({ data: proof, error: null });
    const from = vi.fn().mockReturnValue({ download });
    await expect(new SupabaseCertificationStorage({ storage: { from } }).download("member/mission/proof.webp")).resolves.toBe(proof);
    expect(from).toHaveBeenCalledExactlyOnceWith("certification-proofs");
    expect(download).toHaveBeenCalledExactlyOnceWith("member/mission/proof.webp");
  });
});

describe("SupabaseTelegramCertificationQueue", () => {
  it("strictly parses claims and uses the certification RPC names", async () => {
    const raw = {
      delivery_id: deliveryId, submission_id: submissionId, callback_token: callbackToken, expected_review_revision: 3,
      creator_name: "엘리나", mission_title: "팬미팅 인증", membership_platform: "Weverse", applicant_nickname: "별빛 팬",
      attempt_number: 2, submitted_at: "2026-09-15T01:23:45.000Z", note: null,
      reward: { score_points: 30, ticket_amount: 0, stamp_count: 0 },
      uploads: [{ upload_id: firstUploadId, upload_order: 1, object_path: "proofs/first.jpg", content_type: "image/jpeg", width: 1600, height: 1200 }],
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: raw, error: null })
      .mockResolvedValueOnce({ data: { accepted: true, status: "sending" }, error: null })
      .mockResolvedValueOnce({ data: { accepted: true, status: "sent" }, error: null })
      .mockResolvedValueOnce({ data: { enabled: true, chat_id: chatId, activated_at: "2026-09-15T00:00:00Z", next_send_at: "2026-09-15T00:00:00Z", lease_expires_at: null, pending: 0, claimed: 0, sending: 0, sent: 1, partial: 0, failed: 0, delivery_unknown: 0, skipped: 0 }, error: null });
    const q = new SupabaseTelegramCertificationQueue({ rpc });
    await expect(q.claim(chatId)).resolves.toMatchObject({ deliveryId, uploads: [{ id: firstUploadId }] });
    await q.begin(deliveryId, chatId);
    await q.record(deliveryId, chatId, firstUploadId, 1, "sent", 321, null);
    await expect(q.health()).resolves.toMatchObject({ sent: 1, deliveryUnknown: 0 });
    expect(rpc.mock.calls).toEqual([
      ["claim_telegram_certification_delivery", { p_chat_id: chatId }],
      ["record_telegram_certification_delivery", { p_delivery_id: deliveryId, p_chat_id: chatId, p_outcome: "sending", p_upload_id: null, p_upload_order: null, p_provider_message_id: null, p_retry_after: null, p_error_code: null }],
      ["record_telegram_certification_delivery", { p_delivery_id: deliveryId, p_chat_id: chatId, p_outcome: "sent", p_upload_id: firstUploadId, p_upload_order: 1, p_provider_message_id: 321, p_retry_after: null, p_error_code: null }],
      ["telegram_certification_review_health", undefined],
    ]);
  });

  it("rejects unknown or private claim fields before downloading proof bytes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { unexpected_email: "member@example.com" }, error: null });
    await expect(new SupabaseTelegramCertificationQueue({ rpc }).claim(chatId)).rejects.toThrow("TELEGRAM_CERTIFICATION_INVALID_CLAIM");
  });
});

describe("TelegramCertificationCallbackWorker", () => {
  const callback: TelegramCertificationCallback = {
    updateId: 21, queryId: "callback-query-1", callbackToken, telegramUserId: 88,
    displayName: "민지 김", username: "minji_admin", messageId: 321, caption: "기존 인증 문구",
  };

  it.each([
    [{ outcome: "approved", submissionId }, "승인되었습니다.", "approved"],
    [{ outcome: "already_processed", submissionId }, "이미 처리된 인증입니다.", "already_processed"],
  ] as const)("answers %s and removes the approval button after a conclusive DB result", async (approval, answerText, result) => {
    const queue = { approve: vi.fn().mockResolvedValue(approval) };
    const api = { answerCallback: vi.fn().mockResolvedValue(undefined), editApproved: vi.fn().mockResolvedValue(undefined) };
    const worker = new TelegramCertificationCallbackWorker(queue, api, chatId);
    await expect(worker.handle(callback)).resolves.toBe(result);
    expect(queue.approve).toHaveBeenCalledExactlyOnceWith(chatId, callback);
    expect(api.answerCallback).toHaveBeenCalledExactlyOnceWith(callback.queryId, answerText, false);
    expect(api.editApproved).toHaveBeenCalledExactlyOnceWith(321, "기존 인증 문구", "민지 김", `https://byus.kr/admin/certifications?status=pending&submission=${submissionId}`);
    expect(api.answerCallback.mock.invocationCallOrder[0]).toBeLessThan(api.editApproved.mock.invocationCallOrder[0]!);
  });

  it("does not roll back an approved DB result when the Telegram edit fails", async () => {
    const queue = { approve: vi.fn().mockResolvedValue({ outcome: "approved", submissionId }) };
    const api = { answerCallback: vi.fn().mockResolvedValue(undefined), editApproved: vi.fn().mockRejectedValue(new Error("edit failed")) };
    await expect(new TelegramCertificationCallbackWorker(queue, api, chatId).handle(callback)).resolves.toBe("approved");
    expect(queue.approve).toHaveBeenCalledTimes(1);
    expect(api.answerCallback).toHaveBeenCalledTimes(1);
  });

  it("answers a valid callback with a Korean failure message when approval cannot be completed", async () => {
    const queue = { approve: vi.fn().mockRejectedValue(new Error("db secret")) };
    const api = { answerCallback: vi.fn().mockResolvedValue(undefined), editApproved: vi.fn() };
    await expect(new TelegramCertificationCallbackWorker(queue, api, chatId).handle(callback)).resolves.toBe("failed");
    expect(api.answerCallback).toHaveBeenCalledExactlyOnceWith(callback.queryId, "승인 처리에 실패했습니다. 관리자에서 확인해 주세요.", true);
    expect(api.editApproved).not.toHaveBeenCalled();
  });
});

describe("certification callback adapters", () => {
  it("uses the exact approval RPC identity contract and validates its result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "approved", submission_id: submissionId }, error: null });
    const queue = new SupabaseTelegramCertificationQueue({ rpc });
    const callback: TelegramCertificationCallback = { updateId: 21, queryId: "q", callbackToken, telegramUserId: 88, displayName: "민지 김", username: "minji_admin", messageId: 321, caption: "기존" };
    await expect(queue.approve(chatId, callback)).resolves.toEqual({ outcome: "approved", submissionId });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("approve_telegram_certification", {
      p_chat_id: chatId, p_callback_token: callbackToken, p_action_message_id: 321,
      p_telegram_user_id: 88, p_telegram_display_name: "민지 김", p_telegram_username: "minji_admin",
    });
  });

  it("answers callback queries and edits captions while retaining only the admin URL button", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, result: true }))
      .mockResolvedValueOnce(response(200, { ok: true, result: { message_id: 321 } }));
    const api = new TelegramCertificationHttpClient({ token, chatId }, fetcher);
    await api.answerCallback("callback-query-1", "승인되었습니다.", false);
    await api.editApproved(321, "기존 인증 문구", "민지 김", `https://byus.kr/admin/certifications?status=pending&submission=${submissionId}`);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      `https://api.telegram.org/bot${token}/editMessageCaption`,
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toEqual({ callback_query_id: "callback-query-1", text: "승인되었습니다.", show_alert: false });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1].body))).toEqual({
      chat_id: chatId, message_id: 321, caption: "기존 인증 문구\n\n✅ 승인 완료 · 민지 김",
      reply_markup: { inline_keyboard: [[{ text: "관리자에서 보기", url: `https://byus.kr/admin/certifications?status=pending&submission=${submissionId}` }]] },
    });
  });
});

describe("Telegram certification runtime configuration", () => {
  const source = {
    NOTIFICATION_WORKER_ID: "telegram-cert-test",
    SUPABASE_URL: "https://gmrykvmtmuaeswpajteq.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48),
    WEB_PUSH_VAPID_SUBJECT: "mailto:ops@byus.kr",
    WEB_PUSH_VAPID_PUBLIC_KEY: "a".repeat(88),
    WEB_PUSH_VAPID_PRIVATE_KEY: "b".repeat(43),
    NOTIFICATION_EXTERNAL_ENVIRONMENT: "prod",
  };

  it("is dormant by default or when explicitly disabled", async () => {
    await expect(runTelegramCertificationWorkerOnce(parseNotificationEnv(source))).resolves.toBe(0);
    await expect(runTelegramCertificationWorkerOnce(parseNotificationEnv({ ...source, TELEGRAM_CERTIFICATION_REVIEW_MODE: "disabled" }))).resolves.toBe(0);
  });

  it.each([
    { TELEGRAM_CERTIFICATION_REVIEW_MODE: "invalid" },
    { TELEGRAM_CERTIFICATION_REVIEW_MODE: "enabled", TELEGRAM_BOT_TOKEN: "invalid", TELEGRAM_CHAT_ID: chatId },
    { TELEGRAM_CERTIFICATION_REVIEW_MODE: "enabled", TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "12345" },
    { TELEGRAM_CERTIFICATION_REVIEW_MODE: "enabled", TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, NOTIFICATION_EXTERNAL_ENVIRONMENT: "dev" },
    { TELEGRAM_CERTIFICATION_REVIEW_MODE: "enabled", TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, SUPABASE_URL: "https://other.supabase.co" },
  ])("requires production safeguards when enabled", async (overrides) => {
    await expect(runTelegramCertificationWorkerOnce(parseNotificationEnv({ ...source, ...overrides }))).rejects.toThrow("TELEGRAM_CERTIFICATION_CONFIG_INVALID");
  });

  it("requires the existing alert and command modes so callbacks share their configured chat and single cursor", () => {
    const enabled = { ...source, TELEGRAM_CERTIFICATION_REVIEW_MODE: "enabled", TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId };
    expect(() => validatedTelegramCertificationConfig(parseNotificationEnv(enabled))).toThrow("TELEGRAM_CERTIFICATION_CONFIG_INVALID");
    expect(() => validatedTelegramCertificationConfig(parseNotificationEnv({ ...enabled, TELEGRAM_ALERT_MODE: "enabled" }))).toThrow("TELEGRAM_CERTIFICATION_CONFIG_INVALID");
    expect(validatedTelegramCertificationConfig(parseNotificationEnv({ ...enabled, TELEGRAM_ALERT_MODE: "enabled", TELEGRAM_COMMAND_MODE: "enabled" }))).toEqual({ token, chatId });
  });
});
