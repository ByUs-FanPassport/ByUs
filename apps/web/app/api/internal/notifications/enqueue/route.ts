import { loadServerEnv } from "../../../../../server/config/env";
import { createNotificationRepository } from "../../../../../server/notification/notification-repository";
import { z } from "zod";
export async function GET(request: Request) {
  const parsed = z.string().min(32).safeParse(process.env.CRON_SECRET);
  const secret = parsed.success ? parsed.data : null;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json(
      { error: { code: "UNAUTHORIZED" } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  try {
    const env = loadServerEnv();
    const repository = createNotificationRepository({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return Response.json(
      { enqueued: await repository.enqueueDue(new Date().toISOString()) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: { code: "NOTIFICATION_ENQUEUE_UNAVAILABLE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
