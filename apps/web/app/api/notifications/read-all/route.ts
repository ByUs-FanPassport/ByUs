import { createNotificationRouteDependencies } from "../../../../server/notification/notification-route-dependencies";
import { createReadAllNotificationsHandler } from "../../../../server/notification/notification-route";
export async function POST(request: Request) {
  return createReadAllNotificationsHandler(
    createNotificationRouteDependencies(),
  )(request);
}
