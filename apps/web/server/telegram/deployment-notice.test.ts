import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDeploymentNoticeHandler } from "./deployment-notice";

const input = { deploymentId: 100, receiptId: 200, text: "✅ ByUs 수정사항이 반영됐어요\n\n• 알림의 점을 제목과 같은 높이에 맞췄어요.\n\n확인하기\nhttps://byus.kr/notifications" };
const deployment = { id: 100, sha: "a".repeat(40), environment: "Production", creator: { login: "vercel[bot]" } };
const status = { state: "success", environment: "Production", creator: deployment.creator };
const receipt = { id: 200, head_sha: deployment.sha, name: "Telegram deployment notice", external_id: "100", app: { slug: "github-actions" }, status: "in_progress" };
function setup({ deploymentValue = deployment, statusValue = status, receiptValue = receipt, telegram = { ok: true, result: { message_id: 321, chat: { id: -5187701508 } } } as { ok: boolean; result: unknown }, timeout = false } = {}) {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.includes("api.telegram.org")) { if (timeout) throw new Error("secret URL must not leak"); return Response.json(telegram); }
    if (path.includes("/statuses?")) return Response.json([statusValue]);
    if (path.includes("/check-runs/")) return Response.json(receiptValue);
    return Response.json(deploymentValue);
  });
  const handler = createDeploymentNoticeHandler({ secret: "operator", botToken: "test-token", fetcher: fetcher as typeof fetch });
  const call = (body: unknown = input, secret = "operator") => handler(new Request("https://byus.kr/api/internal/telegram/deployment-notices", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { call, fetcher };
}
describe("deployment notice boundary", () => {
  it("uses fixed room, no parse mode, no redirects, and returns the Telegram message id", async () => {
    const { call, fetcher } = setup(); expect(await (await call()).json()).toEqual({ ok: true, messageId: 321, chatId: -5187701508 });
    const send = fetcher.mock.calls.find(([url]) => String(url).includes("api.telegram.org"));
    const options = (send as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body))).toEqual({ chat_id: -5187701508, text: input.text, link_preview_options: { is_disabled: true } });
    expect(options.redirect).toBe("error");
  });
  it("rejects missing auth and external links before any outbound call", async () => {
    const { call, fetcher } = setup(); expect((await call(input, "wrong")).status).toBe(401);
    expect((await call({ ...input, text: input.text.replace("byus.kr", "evil.test") })).status).toBe(400);
    expect((await call({ ...input, chatId: -999 })).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends a photo and its caption together, pinned to the verified deployment", async () => {
    const { call, fetcher } = setup();
    expect(await (await call({ ...input, images: ["release-notes/images/after.png"] })).json()).toMatchObject({ messageId: 321, messageIds: [321] });
    const sends = fetcher.mock.calls.filter(([url]) => String(url).includes("api.telegram.org"));
    expect(sends).toHaveLength(1); expect(String(sends[0][0])).toMatch(/\/sendPhoto$/);
    const options = (sends[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body))).toEqual({ chat_id: -5187701508, photo: `https://raw.githubusercontent.com/ByUs-FanPassport/ByUs/${deployment.sha}/release-notes/images/after.png`, caption: input.text, show_caption_above_media: true });
  });
  it("sends multiple screenshots as one album and verifies every returned message", async () => {
    const images = ["release-notes/images/before.png", "release-notes/images/after.png"];
    for (const wrongRoom of [false, true]) {
      const { call, fetcher } = setup({ telegram: { ok: true, result: [
        { message_id: 321, chat: { id: -5187701508 } }, { message_id: 322, chat: { id: wrongRoom ? -1 : -5187701508 } },
      ] } });
      const response = await call({ ...input, images });
      expect(response.status).toBe(wrongRoom ? 503 : 200);
      if (!wrongRoom) expect(await response.json()).toMatchObject({ messageIds: [321, 322] });
      const sends = fetcher.mock.calls.filter(([url]) => String(url).includes("api.telegram.org"));
      expect(sends).toHaveLength(1); expect(String(sends[0][0])).toMatch(/\/sendMediaGroup$/);
      const media = JSON.parse(String((sends[0] as unknown as [string, RequestInit])[1].body)).media;
      expect(media[0].caption).toBe(input.text); expect(media[1].caption).toBeUndefined();
      expect(media.map((item: { show_caption_above_media: boolean }) => item.show_caption_above_media)).toEqual([true, true]);
    }
  });
  it("rejects unsafe images and excessive captions before any outbound call", async () => {
    const { call, fetcher } = setup();
    for (const images of [[], ["https://evil.test/a.png"], ["release-notes/images/../a.png"], ["release-notes/images/a.svg"], Array(11).fill("release-notes/images/a.png")]) {
      expect((await call({ ...input, images })).status).toBe(400);
    }
    expect((await call({ ...input, text: `${input.text}\n${"가".repeat(1024)}`, images: ["release-notes/images/a.png"] })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { deploymentValue: { ...deployment, environment: "Preview" } },
    { deploymentValue: { ...deployment, sha: "../../other" } },
    { statusValue: { ...status, state: "failure" } },
    { receiptValue: { ...receipt, external_id: "101" } },
    { receiptValue: { ...receipt, status: "completed" } },
    { receiptValue: { ...receipt, app: { slug: "unknown" } } },
  ])("does not send without trusted success and reserved receipt", async (config) => {
    const { call, fetcher } = setup(config); expect((await call()).status).toBe(409);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("api.telegram.org"))).toBe(false);
  });
  it("keeps timeouts uncertain and never retries the Telegram POST", async () => {
    const { call, fetcher } = setup({ timeout: true }); const response = await call();
    expect(await response.json()).toEqual({ error: { code: "TELEGRAM_NOTICE_UNCERTAIN" } });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("api.telegram.org"))).toHaveLength(1);
  });
  it("marks a Telegram negative response as a definitive rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const telegram = { ok: false, result: null, error_code: 400, description: "Failed https://secret.test/test-token test-token" };
      const { call } = setup({ telegram });
      expect(await (await call()).json()).toEqual({ error: { code: "TELEGRAM_NOTICE_REJECTED" } });
      expect(warn).toHaveBeenCalledWith("TELEGRAM_NOTICE_REJECTED", { code: 400, description: "Failed [url] [redacted]" });
    } finally { warn.mockRestore(); }
  });
});
