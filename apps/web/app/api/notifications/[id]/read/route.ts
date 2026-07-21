import { createNotificationRouteDependencies } from "../../../../../server/notification/notification-route-dependencies";
import { createReadNotificationHandler } from "../../../../../server/notification/notification-route";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return createReadNotificationHandler(createNotificationRouteDependencies())(
    request,
    id,
  );
}
