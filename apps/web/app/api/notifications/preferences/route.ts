import { createNotificationRouteDependencies } from "../../../../server/notification/notification-route-dependencies";
import {
  createGetPreferencesHandler,
  createPatchPreferencesHandler,
} from "../../../../server/notification/notification-route";
export async function GET(request: Request) {
  return createGetPreferencesHandler(createNotificationRouteDependencies())(
    request,
  );
}
export async function PATCH(request: Request) {
  return createPatchPreferencesHandler(createNotificationRouteDependencies())(
    request,
  );
}
