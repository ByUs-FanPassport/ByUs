import { createNotificationRouteDependencies } from "../../../server/notification/notification-route-dependencies";
import { createGetNotificationsHandler } from "../../../server/notification/notification-route";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return createGetNotificationsHandler(createNotificationRouteDependencies())(
    request,
  );
}
