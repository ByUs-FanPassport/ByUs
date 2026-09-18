import { createTelegramBugReportDependencies } from "@/server/telegram/bug-report-dependencies";
import { createTelegramBugReportCompletionHandler } from "@/server/telegram/bug-report-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
): Promise<Response> {
  try {
    const dependencies = createTelegramBugReportDependencies();
    if (!dependencies.telegram) throw new Error("TELEGRAM_BOT_NOT_CONFIGURED");
    const { messageId } = await context.params;
    return createTelegramBugReportCompletionHandler({
      secret: dependencies.operatorSecret,
      repository: dependencies.repository,
      telegram: dependencies.telegram,
    })(request, Number(messageId));
  } catch {
    return Response.json(
      { error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } },
      { status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" } },
    );
  }
}
