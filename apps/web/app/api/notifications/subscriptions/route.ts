import { createNotificationRouteDependencies } from "../../../../server/notification/notification-route-dependencies";
import {
  createDeleteSubscriptionHandler,
  createPutSubscriptionHandler,
} from "../../../../server/notification/notification-route";
export async function PUT(request: Request) {
  return createPutSubscriptionHandler(createNotificationRouteDependencies())(
    request,
  );
}
export async function DELETE(request: Request) {
  return createDeleteSubscriptionHandler(createNotificationRouteDependencies())(
    request,
  );
}
