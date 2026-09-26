import { participationRoute } from "@/server/schedules/routes";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("admin-live-submissions", request, await context.params); }
