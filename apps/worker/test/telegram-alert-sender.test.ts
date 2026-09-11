import { describe, expect, it, vi } from "vitest";
import { TelegramHttpSender, TelegramSendError } from "../src/telegram-alert-worker.js";

const token = `123456789:${"A".repeat(35)}`;
const chatId = "-1001234567890";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TelegramHttpSender", () => {
  it("sends safe plain text once with previews disabled and returns the message id", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 321 } }));
    const sender = new TelegramHttpSender({ token, chatId }, fetcher);
    await expect(sender.sendText("설정이 완료됐습니다.")).resolves.toBe(321n);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: chatId, text: "설정이 완료됐습니다.", link_preview_options: { is_disabled: true } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [429, { ok: false, error_code: 429, parameters: { retry_after: 999999 } }, "throttled", 86400],
    [200, { ok: false, error_code: 429, parameters: { retry_after: 0 } }, "throttled", 1],
    [400, { ok: false, description: `secret ${token}` }, "rejected", undefined],
    [401, { ok: false }, "rejected", undefined],
    [403, { ok: false }, "rejected", undefined],
    [500, { ok: false, description: "provider exploded" }, "unknown", undefined],
    [500, { ok: false, error_code: 400 }, "unknown", undefined],
  ])("classifies HTTP %s without exposing provider details", async (status, body, outcome, retryAfter) => {
    const sender = new TelegramHttpSender({ token, chatId }, vi.fn().mockResolvedValue(response(status as number, body)));
    const error = await sender.sendText("안전한 문구").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TelegramSendError);
    expect(error).toMatchObject({ outcome, retryAfter });
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain("provider exploded");
  });

  it.each([
    ["network", () => Promise.reject(new Error(`request https://api.telegram.org/bot${token}/sendMessage failed`))],
    ["timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["malformed success", () => Promise.resolve(response(200, { ok: true, result: {} }))],
    ["invalid JSON", () => Promise.resolve(new Response("not-json", { status: 200 }))],
  ])("treats %s as unknown without automatic retry", async (_name, implementation) => {
    const fetcher = vi.fn().mockImplementation(implementation);
    const sender = new TelegramHttpSender({ token, chatId }, fetcher);
    const error = await sender.sendText("안전한 문구").catch((value: unknown) => value);
    expect(error).toMatchObject({ outcome: "unknown" });
    expect(String(error)).toBe("Error: TELEGRAM_SEND_UNKNOWN");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects empty or overlong text before making a request", async () => {
    const fetcher = vi.fn();
    const sender = new TelegramHttpSender({ token, chatId }, fetcher);
    await expect(sender.sendText("")).rejects.toMatchObject({ outcome: "rejected" });
    await expect(sender.sendText("가".repeat(4001))).rejects.toMatchObject({ outcome: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
