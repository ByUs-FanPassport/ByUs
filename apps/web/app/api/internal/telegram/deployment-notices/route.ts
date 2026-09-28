import { loadServerEnv } from "@/server/config/env";
import { createDeploymentNoticeHandler } from "@/server/telegram/deployment-notice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const env = loadServerEnv();
    return await createDeploymentNoticeHandler({
      secret: env.TELEGRAM_BUG_REPORT_OPERATOR_SECRET,
      botToken: env.TELEGRAM_BUG_REPORT_BOT_TOKEN,
    })(request);
  } catch {
    return Response.json({ error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } }, {
      status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" },
    });
  }
}
