import { createRsvpAdminHandler } from "@/server/byus-day/rsvp-admin-route";
import { createFanpageDependencies } from "@/server/fanpage/dependencies";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return createRsvpAdminHandler(createFanpageDependencies())(request);
}
