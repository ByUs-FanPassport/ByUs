import { createTelegramBugReportDependencies } from "@/server/telegram/bug-report-dependencies";
import { createTelegramBugReportListHandler } from "@/server/telegram/bug-report-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = createTelegramBugReportDependencies();
    return createTelegramBugReportListHandler({
      secret: dependencies.operatorSecret,
      repository: dependencies.repository,
    })(request);
  } catch {
    return Response.json(
      { error: { code: "TELEGRAM_OPERATOR_UNAVAILABLE" } },
      { status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" } },
    );
  }
}
