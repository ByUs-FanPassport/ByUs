import { createTelegramBugReportDependencies } from "@/server/telegram/bug-report-dependencies";
import { createTelegramBugReportWebhookHandler } from "@/server/telegram/bug-report-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const dependencies = createTelegramBugReportDependencies();
    return createTelegramBugReportWebhookHandler({
      secret: dependencies.webhookSecret,
      repository: dependencies.repository,
    })(request);
  } catch {
    return Response.json(
      { error: { code: "TELEGRAM_WEBHOOK_UNAVAILABLE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
