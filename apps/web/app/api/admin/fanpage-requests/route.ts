import { participationRoute } from "@/server/schedules/routes";
export async function GET(request: Request) { return participationRoute("admin-requests", request); }
