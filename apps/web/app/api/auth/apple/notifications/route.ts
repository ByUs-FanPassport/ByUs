import {
  appleLifecycleEnabled, createAppleLifecycleRepository,
} from "../../../../../server/auth/apple-notifications/apple-lifecycle";
import { receiveAppleNotification } from "../../../../../server/auth/apple-notifications/notification-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!appleLifecycleEnabled()) throw new Error("Apple notifications are not enabled");
    return await receiveAppleNotification(request, { repository: createAppleLifecycleRepository() });
  } catch {
    return Response.json({ error: { code: "APPLE_NOTIFICATION_UNAVAILABLE" } }, {
      status: 503, headers: { "cache-control": "no-store" },
    });
  }
}
