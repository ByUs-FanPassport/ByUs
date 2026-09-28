import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDeploymentNoticeHandler } from "./deployment-notice";

const input = { deploymentId: 100, receiptId: 200, text: "✅ ByUs 수정사항이 반영됐어요\n\n• 알림의 점을 제목과 같은 높이에 맞췄어요.\n\n확인하기\nhttps://byus.kr/notifications" };
const deployment = { id: 100, sha: "a".repeat(40), environment: "Production", creator: { login: "vercel[bot]" } };
const status = { state: "success", environment: "Production", creator: deployment.creator };
const receipt = { id: 200, head_sha: deployment.sha, name: "Telegram deployment notice", external_id: "100", app: { slug: "github-actions" }, status: "in_progress" };
function setup({ deploymentValue = deployment, statusValue = status, receiptValue = receipt, telegram = { ok: true, result: { message_id: 321, chat: { id: -5187701508 } } }, timeout = false } = {}) {
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
  it.each([
    { deploymentValue: { ...deployment, environment: "Preview" } },
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
    const { call } = setup({ telegram: { ok: false, result: { message_id: 0, chat: { id: 0 } } } });
    expect(await (await call()).json()).toEqual({ error: { code: "TELEGRAM_NOTICE_REJECTED" } });
  });
});
