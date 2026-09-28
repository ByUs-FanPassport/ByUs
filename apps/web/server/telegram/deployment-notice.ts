import "server-only";

import { z } from "zod";
import { boundedJson, operatorAuthorized } from "./bug-report-routes";
import { SALLY_BUG_REPORT_CHAT_ID } from "./bug-report-repository";

const HEADERS = { "cache-control": "private, no-store", vary: "Authorization" };
const GITHUB_REPO = "https://api.github.com/repos/ByUs-FanPassport/ByUs";
const requestSchema = z.object({
  deploymentId: z.number().int().positive().safe(),
  receiptId: z.number().int().positive().safe(),
  images: z.array(z.string().regex(/^release-notes\/images\/[a-z0-9-]+\.png$/)).min(1).max(10).optional(),
  text: z.string().min(20).max(3900).refine(text => {
    if (!text.startsWith("✅ ByUs 수정사항이 반영됐어요\n") || !/[가-힣]/.test(text) || /[\x00-\x09\x0b-\x1f\x7f]/.test(text)) return false;
    const links = text.match(/https?:\/\/\S+/g) ?? [];
    return links.length > 0 && links.every(link => /^https:\/\/byus\.kr\/[a-zA-Z0-9/_-]*$/.test(link));
  }),
}).strict().refine(input => !input.images?.length || input.text.length <= 1024);

export function createDeploymentNoticeHandler({ secret, botToken, fetcher = fetch }: {
  secret?: string; botToken?: string; fetcher?: typeof fetch;
}) {
  return async (request: Request): Promise<Response> => {
    const fail = (code: string, status: number) => Response.json({ error: { code } }, { status, headers: HEADERS });
    if (!secret || !botToken) return fail("TELEGRAM_OPERATOR_UNAVAILABLE", 503);
    if (!operatorAuthorized(request, secret)) return fail("UNAUTHORIZED", 401);
    let input: z.infer<typeof requestSchema>;
    try { input = requestSchema.parse(await boundedJson(request)); }
    catch { return fail("INVALID_REQUEST", 400); }
    let deployedSha: string;
    try {
      async function github(path: string) {
        const response = await fetcher(`${GITHUB_REPO}${path}`, { headers: { accept: "application/vnd.github+json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("GITHUB_UNAVAILABLE");
        return response.json();
      }
      const [deployment, statuses, receipt] = await Promise.all([
        github(`/deployments/${input.deploymentId}`),
        github(`/deployments/${input.deploymentId}/statuses?per_page=1`),
        github(`/check-runs/${input.receiptId}`),
      ]);
      const status = statuses[0];
      if (deployment.id !== input.deploymentId || !/^[0-9a-f]{40}$/.test(deployment.sha ?? "") || deployment.environment !== "Production" || deployment.creator?.login !== "vercel[bot]" ||
          status?.state !== "success" || status.environment !== "Production" || status.creator?.login !== "vercel[bot]") return fail("DEPLOYMENT_NOT_READY", 409);
      if (receipt.id !== input.receiptId || receipt.name !== "Telegram deployment notice" || receipt.app?.slug !== "github-actions" ||
          receipt.head_sha !== deployment.sha || receipt.external_id !== String(deployment.id) || receipt.status !== "in_progress") return fail("RECEIPT_NOT_RESERVED", 409);
      deployedSha = deployment.sha;
    } catch { return fail("DEPLOYMENT_VERIFICATION_UNAVAILABLE", 503); }

    // The globally serialized CI sender owns the receipt. Never retry a POST with an uncertain result.
    try {
      const photos = input.images?.map(path => `https://raw.githubusercontent.com/ByUs-FanPassport/ByUs/${deployedSha}/${path}`) ?? [];
      const method = photos.length > 1 ? "sendMediaGroup" : photos.length ? "sendPhoto" : "sendMessage";
      const content = photos.length > 1
        ? { media: photos.map((media, i) => ({ type: "photo", media, show_caption_above_media: true, ...(i === 0 ? { caption: input.text } : {}) })) }
        : photos.length ? { photo: photos[0], caption: input.text, show_caption_above_media: true }
          : { text: input.text, link_preview_options: { is_disabled: true } };
      // One Telegram request keeps text and screenshots together; never fall back to a second send.
      const response = await fetcher(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: SALLY_BUG_REPORT_CHAT_ID, ...content }),
        redirect: "error", signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json();
      if (payload?.ok === false) {
        console.warn("TELEGRAM_NOTICE_REJECTED", {
          code: payload.error_code,
          description: String(payload.description ?? "").replaceAll(botToken, "[redacted]").replace(/https?:\/\/\S+/g, "[url]").slice(0, 240),
        });
        return fail("TELEGRAM_NOTICE_REJECTED", 502);
      }
      const messages = photos.length > 1 ? payload?.result : [payload?.result];
      if (!response.ok || payload?.ok !== true || !Array.isArray(messages) || messages.length !== Math.max(photos.length, 1) ||
          messages.some(message => !Number.isSafeInteger(message?.message_id) || message?.chat?.id !== SALLY_BUG_REPORT_CHAT_ID)) return fail("TELEGRAM_NOTICE_UNCERTAIN", 503);
      return Response.json({ ok: true, messageId: messages[0].message_id, chatId: SALLY_BUG_REPORT_CHAT_ID,
        ...(photos.length ? { messageIds: messages.map(message => message.message_id) } : {}) }, { headers: HEADERS });
    } catch { return fail("TELEGRAM_NOTICE_UNCERTAIN", 503); }
  };
}
